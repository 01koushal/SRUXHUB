import { describe, expect, it } from 'vitest';
import { AppwriteStorageProvider, parseUploadResponse } from './provider';

describe('upload response handling', () => {
  it('accepts the metadata shape returned by the upload API', () => {
    expect(parseUploadResponse(JSON.stringify({
      id: 'file-1', name: 'notes.pdf', mimeType: 'application/pdf', size: 42, provider: 'appwrite',
    }), 201)).toMatchObject({ id: 'file-1', name: 'notes.pdf', provider: 'appwrite' });
  });

  it('shows server errors returned as JSON', () => {
    expect(() => parseUploadResponse(JSON.stringify({ error: 'Join this community before uploading' }), 403))
      .toThrow('Join this community before uploading');
  });

  it('explains non-JSON platform errors instead of hiding them', () => {
    expect(() => parseUploadResponse('<html><body>Request Entity Too Large</body></html>', 413))
      .toThrow('Upload server returned HTTP 413: Request Entity Too Large');
  });

  it('rejects a success response missing required file metadata', () => {
    expect(() => parseUploadResponse('{"id":"file-1"}', 201))
      .toThrow('Upload response is missing file metadata (HTTP 201).');
  });

  it('rejects files above the server limit before opening a request', async () => {
    const provider = new AppwriteStorageProvider();
    await expect(provider.upload({ size: 4 * 1024 * 1024 + 1 } as File, 'community', 'token'))
      .rejects.toThrow('File exceeds the 4 MB upload limit.');
  });
});
