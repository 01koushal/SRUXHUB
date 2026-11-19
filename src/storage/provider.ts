export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
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
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Maximum file size is 25 MB.');
  const extension = allowedTypes.get(getUploadMime(file));
  if (!extension || !file.name.toLowerCase().endsWith(`.${extension}`)) {
    throw new Error('Supported files: images, PDF, PowerPoint, Word and ZIP.');
  }
}

function uploadChunk(
  file: File,
  chunk: Blob,
  communityId: string,
  token: string,
  action: 'start' | 'chunk',
  sessionId: string | undefined,
  progress: (loaded: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Upload was cancelled.'));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Upload-Action', action);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-File-Mime', getUploadMime(file));
    xhr.setRequestHeader('X-File-Size', String(file.size));
    xhr.setRequestHeader('X-Community-Id', communityId);
    if (sessionId) xhr.setRequestHeader('X-Upload-Session', sessionId);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) progress(event.loaded);
    };
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const finish = () => signal?.removeEventListener('abort', abort);
    xhr.onerror = () => { finish(); reject(new Error('Upload connection failed. Retry the file.')); };
    xhr.ontimeout = () => { finish(); reject(new Error('Upload timed out. Retry the file.')); };
    xhr.onabort = () => { finish(); reject(new Error('Upload was cancelled.')); };
    xhr.onload = () => {
      finish();
      try {
        const body = JSON.parse(xhr.responseText) as Record<string, unknown>;
        if (xhr.status < 200 || xhr.status >= 300) {
          const existing = body.existingFile && typeof body.existingFile === 'object'
            ? toStoredFile(body.existingFile as Record<string, unknown>)
            : undefined;
          reject(new FileUploadError(typeof body.error === 'string' ? body.error : `Upload failed (HTTP ${xhr.status}).`, existing));
        } else {
          resolve({ status: xhr.status, body });
        }
      } catch {
        reject(new Error(`Upload server returned an unreadable response (HTTP ${xhr.status || 'unknown'}).`));
      }
    };
    xhr.timeout = 90_000;
    xhr.send(chunk);
  });
}

export class AppwriteStorageProvider implements StorageProvider {
  async upload(file: File, communityId: string, token: string, onProgress?: (percent: number) => void, signal?: AbortSignal) {
    validateUpload(file);
    let uploadedBefore = 0;
    let sessionId: string | undefined;
    try {
      let response = await uploadChunk(
        file,
        file.slice(0, Math.min(file.size, UPLOAD_CHUNK_BYTES)),
        communityId,
        token,
        'start',
        undefined,
        loaded => onProgress?.(Math.min(99, Math.floor((uploadedBefore + loaded) / file.size * 100))),
        signal,
      );
      if (response.status === 201) {
        onProgress?.(100);
        return parseUploadResponse(JSON.stringify(response.body), response.status);
      }
      sessionId = typeof response.body.uploadSessionId === 'string' ? response.body.uploadSessionId : undefined;
      let offset = Number(response.body.nextOffset);
      if (!sessionId || !Number.isInteger(offset) || offset <= 0) throw new Error('Upload server did not create a valid upload session.');
      uploadedBefore = offset;

      while (offset < file.size) {
        if (signal?.aborted) throw new Error('Upload was cancelled.');
        const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
        response = await uploadChunk(
          file,
          file.slice(offset, end),
          communityId,
          token,
          'chunk',
          sessionId,
          loaded => onProgress?.(Math.min(99, Math.floor((uploadedBefore + loaded) / file.size * 100))),
          signal,
        );
        if (response.status === 201) {
          onProgress?.(100);
          return parseUploadResponse(JSON.stringify(response.body), response.status);
        }
        offset = Number(response.body.nextOffset);
        if (!Number.isInteger(offset) || offset <= uploadedBefore || offset > file.size) {
          throw new Error('Upload server returned an invalid chunk offset.');
        }
        uploadedBefore = offset;
        onProgress?.(Math.floor(offset / file.size * 100));
      }
      throw new Error('Upload finished without a completion response. Retry the file.');
    } catch (error) {
      if (sessionId) await this.cancelUpload(sessionId, token);
      throw error;
    }
  }

  async cancelUpload(sessionId: string, token: string) {
    try {
      await fetch('/api/files/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Upload-Action': 'cancel', 'X-Upload-Session': sessionId },
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
