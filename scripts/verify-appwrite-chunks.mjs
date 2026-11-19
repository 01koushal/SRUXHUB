import { createHash, randomUUID } from 'node:crypto';

const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_BUCKET_ID'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) throw new Error(`Missing server configuration: ${missing.join(', ')}`);

const endpoint = process.env.APPWRITE_ENDPOINT.replace(/\/$/, '');
const bucket = process.env.APPWRITE_BUCKET_ID;
const requestedChunkSize = process.argv.find(value => value.startsWith('--chunk-size='));
const chunkSize = requestedChunkSize ? Number(requestedChunkSize.slice('--chunk-size='.length)) : 5 * 1024 * 1024;
const sizes = [2, 5, 10, 25].map(size => size * 1024 * 1024);
const sendInitialId = process.argv.includes('--initial-id');
if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 5 * 1024 * 1024) {
  throw new Error('Chunk size must be between 1 byte and 5 MiB.');
}

function headers(fileId, range, isInitial) {
  const values = {
    'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
    'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
  };
  if (range) {
    values['Content-Range'] = range;
    if (!isInitial || sendInitialId) values['X-Appwrite-ID'] = fileId;
  }
  return values;
}

async function remove(fileId) {
  const response = await fetch(`${endpoint}/storage/buckets/${encodeURIComponent(bucket)}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: headers(fileId),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not remove temporary Appwrite test file (HTTP ${response.status}).`);
  }
  console.log(JSON.stringify({ temporaryFileDeleted: true, status: response.status }));
}

async function verify(size) {
  const fileId = randomUUID();
  const bytes = Buffer.alloc(size, 0x61);
  Buffer.from('%PDF-1.7\n').copy(bytes);
  const expectedHash = createHash('sha256').update(bytes).digest('hex');
  let providerId = fileId;

  try {
    for (let start = 0, chunkNumber = 1; start < size; start += chunkSize, chunkNumber++) {
      const endExclusive = Math.min(start + chunkSize, size);
      const isInitial = start === 0;
      const range = size > chunkSize ? `bytes ${start}-${endExclusive - 1}/${size}` : undefined;
      const form = new FormData();
      form.append('fileId', providerId);
      form.append('file', new Blob([bytes.subarray(start, endExclusive)], { type: 'application/pdf' }), `upload-check-${size}.pdf`);
      const response = await fetch(`${endpoint}/storage/buckets/${encodeURIComponent(bucket)}/files`, {
        method: 'POST',
        headers: headers(providerId, range, isInitial),
        body: form,
      });
      let body = {};
      try { body = await response.json(); } catch { /* Capture status below. */ }
      const message = typeof body.message === 'string' ? body.message : null;
      const returnedId = typeof body.$id === 'string' ? body.$id : null;
      console.log(JSON.stringify({
        size,
        chunkNumber,
        startOffset: start,
        endOffset: endExclusive - 1,
        totalSize: size,
        receivedBytes: endExclusive - start,
        appwriteStatus: response.status,
        appwriteFileId: returnedId,
        expectedFileId: providerId,
        appwriteError: message,
        sentInitialAppwriteId: isInitial ? sendInitialId : true,
      }));
      if (!response.ok) throw new Error(message || `Appwrite rejected chunk ${chunkNumber} with HTTP ${response.status}`);
      if (!returnedId) throw new Error(`Appwrite did not return a file ID for chunk ${chunkNumber}`);
      if (returnedId !== providerId) throw new Error(`Appwrite changed the file ID during chunk ${chunkNumber}`);
    }

    const response = await fetch(`${endpoint}/storage/buckets/${encodeURIComponent(bucket)}/files/${encodeURIComponent(providerId)}/download`, {
      headers: headers(providerId),
    });
    const downloaded = Buffer.from(await response.arrayBuffer());
    const actualHash = createHash('sha256').update(downloaded).digest('hex');
    if (!response.ok || downloaded.length !== size || actualHash !== expectedHash) {
      throw new Error(`Stored file verification failed for ${size} bytes`);
    }
    console.log(JSON.stringify({ size, verified: true, bytes: downloaded.length, sha256Matches: true }));
  } finally {
    await remove(providerId);
  }
}

for (const size of sizes) await verify(size);
