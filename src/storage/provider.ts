export type StoredFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  provider: 'appwrite';
  communityName?: string;
};

export interface StorageProvider {
  upload(file: File, communityId: string, token: string, onProgress?: (percent: number) => void): Promise<StoredFile>;
  download(fileId: string, token: string): Promise<Blob>;
  delete(fileId: string, token: string): Promise<void>;
  getMetadata(fileId: string, token: string): Promise<StoredFile>;
  getFileIdentifier(file: StoredFile): string;
}

export function parseUploadResponse(responseText: string, status: number): StoredFile {
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    const readable = responseText
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    throw new Error(readable
      ? `Upload server returned HTTP ${status || 'unknown'}: ${readable}`
      : `Upload server returned an unreadable response (HTTP ${status || 'unknown'}).`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Upload server returned an invalid response (HTTP ${status || 'unknown'}).`);
  }
  const body = payload as Record<string, unknown>;
  if (status < 200 || status >= 300) {
    throw new Error(typeof body.error === 'string' ? body.error : `Upload failed (HTTP ${status}).`);
  }
  if (typeof body.id !== 'string' || typeof body.name !== 'string' ||
      typeof body.mimeType !== 'string' || typeof body.size !== 'number' ||
      body.provider !== 'appwrite') {
    throw new Error(`Upload response is missing file metadata (HTTP ${status}).`);
  }
  return body as unknown as StoredFile;
}

export class AppwriteStorageProvider implements StorageProvider {
  async upload(file: File, communityId: string, token: string, onProgress?: (percent: number) => void) {
    if (file.size > 4 * 1024 * 1024) throw new Error('File exceeds the 4 MB upload limit.');
    return new Promise<StoredFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.setRequestHeader('X-Community-Id', communityId);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
      };
      xhr.onerror = () => reject(new Error('Upload connection failed. Check the network and try again.'));
      xhr.ontimeout = () => reject(new Error('Upload timed out. Try again with a smaller file.'));
      xhr.onabort = () => reject(new Error('Upload was cancelled.'));
      xhr.onload = () => {
        try {
          const data = parseUploadResponse(xhr.responseText, xhr.status);
          onProgress?.(100);
          resolve(data);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Upload failed.'));
        }
      };
      xhr.timeout = 120_000;
      xhr.send(file);
    });
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
