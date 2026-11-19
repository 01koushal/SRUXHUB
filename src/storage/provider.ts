import { Account, Client, Storage } from 'appwrite';

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

export type StoredFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  provider: 'appwrite';
  communityId?: string;
  communityName?: string;
  uploaderId?: string;
  uploaderName?: string;
  uploaderUsername?: string;
  uploadedAt?: string;
  upvotes?: number;
  hasVoted?: boolean;
  existingFile?: StoredFile;
};

export interface StorageProvider {
  upload(file: File, communityId: string, token: string, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<StoredFile>;
  download(fileId: string, token: string): Promise<Blob>;
  delete(fileId: string, token: string): Promise<void>;
  getMetadata(fileId: string, token: string): Promise<StoredFile>;
  getFileIdentifier(file: StoredFile): string;
}

const allowedTypes = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ['application/pdf', 'pdf'],
  ['application/vnd.ms-powerpoint', 'ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/zip', 'zip'], ['application/x-zip-compressed', 'zip'],
]);

export class FileUploadError extends Error {
  existingFile?: StoredFile;

  constructor(message: string, existingFile?: StoredFile) {
    super(message);
    this.name = 'FileUploadError';
    this.existingFile = existingFile;
  }
}

export function parseUploadResponse(responseText: string, status: number): StoredFile {
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    const readable = responseText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(readable
      ? `Upload server returned HTTP ${status || 'unknown'}: ${readable}`
      : `Upload server returned an unreadable response (HTTP ${status || 'unknown'}).`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Upload server returned an invalid response (HTTP ${status || 'unknown'}).`);
  }
  const body = payload as Record<string, unknown>;
  if (status < 200 || status >= 300) {
    const existing = body.existingFile && typeof body.existingFile === 'object'
      ? toStoredFile(body.existingFile as Record<string, unknown>)
      : undefined;
    throw new FileUploadError(typeof body.error === 'string' ? body.error : `Upload failed (HTTP ${status}).`, existing);
  }
  if (typeof body.id !== 'string' || typeof body.name !== 'string' ||
      typeof body.mimeType !== 'string' || typeof body.size !== 'number' || body.provider !== 'appwrite') {
    throw new Error(`Upload response is missing file metadata (HTTP ${status}).`);
  }
  return toStoredFile(body);
}

function toStoredFile(body: Record<string, unknown>): StoredFile {
  return {
    id: String(body.id),
    name: String(body.name),
    mimeType: String(body.mimeType),
    size: Number(body.size),
    provider: 'appwrite',
    communityId: typeof body.communityId === 'string' ? body.communityId : undefined,
    uploaderId: typeof body.uploaderId === 'string' ? body.uploaderId : undefined,
    uploadedAt: typeof body.uploadedAt === 'string' ? body.uploadedAt : undefined,
  };
}

function getUploadMime(file: File) {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith('.zip')) return 'application/zip';
  return '';
}

function validateUpload(file: File) {
  if (!file.size) throw new Error('Choose a non-empty file.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Maximum file size is 300 MB.');
  const extension = allowedTypes.get(getUploadMime(file));
  if (!extension || !file.name.toLowerCase().endsWith(`.${extension}`)) {
    throw new Error('Supported files: images, PDF, PowerPoint, Word and ZIP.');
  }
}

export class AppwriteStorageProvider implements StorageProvider {
  async upload(file: File, communityId: string, token: string, onProgress?: (percent: number) => void, signal?: AbortSignal) {
    validateUpload(file);
    if (signal?.aborted) throw new Error('Upload was cancelled.');
    const authorize = await fetch('/api/files/direct', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'authorize', communityId, name: file.name, mime: getUploadMime(file), size: file.size }),
    });
    const authorization = await authorize.json() as Record<string, unknown>;
    if (!authorize.ok) throw new FileUploadError(typeof authorization.error === 'string' ? authorization.error : 'Could not authorize upload.');
    const required = ['uploadId', 'userId', 'secret', 'fileId', 'endpoint', 'projectId', 'bucketId'];
    if (required.some(key => typeof authorization[key] !== 'string')) throw new Error('Upload server returned an invalid authorization.');
    const uploadId = String(authorization.uploadId);
    const client = new Client().setEndpoint(String(authorization.endpoint)).setProject(String(authorization.projectId));
    const account = new Account(client);
    const storage = new Storage(client);
    try {
      await account.createSession({ userId: String(authorization.userId), secret: String(authorization.secret) });
      if (signal?.aborted) throw new Error('Upload was cancelled.');
      await storage.createFile({ bucketId: String(authorization.bucketId), fileId: String(authorization.fileId), file, onProgress: progress => onProgress?.(Math.floor(progress.progress)) });
      const finalize = await fetch('/api/files/direct', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finalize', uploadId: authorization.uploadId }),
      });
      const finalized = await finalize.text();
      onProgress?.(100);
      return parseUploadResponse(finalized, finalize.status);
    } catch (error) {
      await this.cancelUpload(uploadId, token);
      throw error;
    } finally {
      await account.deleteSession({ sessionId: 'current' }).catch(() => undefined);
    }
  }

  async cancelUpload(sessionId: string, token: string) {
    try {
      await fetch('/api/files/direct', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', uploadId: sessionId }),
      });
    } catch { /* Expired sessions are removed by the server cleanup pass. */ }
  }

  async download(fileId: string, token: string) {
    const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Download denied or file unavailable.'));
    return response.blob();
  }

  async delete(fileId: string, token: string) {
    const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Delete denied or file unavailable.'));
  }

  async getMetadata(fileId: string, token: string) {
    const response = await fetch(`/api/files/${encodeURIComponent(fileId)}?metadata=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await readApiError(response, 'File unavailable.'));
    return response.json() as Promise<StoredFile>;
  }

  getFileIdentifier(file: StoredFile) { return file.id; }
}

async function readApiError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch { /* Use an HTTP status when the server did not return JSON. */ }
  return `${fallback} (HTTP ${response.status}).`;
}

export const storageProvider: StorageProvider = new AppwriteStorageProvider();
