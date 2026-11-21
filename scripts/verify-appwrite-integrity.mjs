import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';

const [originalPath, fileId, expectedMimeArg] = process.argv.slice(2);
const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_BUCKET_ID'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing server configuration: ${missing.join(', ')}`);
if (!originalPath || !fileId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(fileId)) {
  throw new Error('Usage: node --env-file=.env scripts/verify-appwrite-integrity.mjs <original-file-path> <appwrite-file-id> [original-mime-type]');
}

const endpoint = process.env.APPWRITE_ENDPOINT.replace(/\/$/, '');
const headers = {
  'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
  'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
};
const base = `${endpoint}/storage/buckets/${encodeURIComponent(process.env.APPWRITE_BUCKET_ID)}/files/${encodeURIComponent(fileId)}`;
const originalStat = await stat(originalPath);
const metadataResponse = await fetch(base, { headers });
if (!metadataResponse.ok) throw new Error(`Appwrite metadata request failed (HTTP ${metadataResponse.status}).`);
const metadata = await metadataResponse.json();
const downloadResponse = await fetch(`${base}/download`, { headers });
if (!downloadResponse.ok || !downloadResponse.body) throw new Error(`Appwrite download failed (HTTP ${downloadResponse.status}).`);

async function hashStream(stream) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}

const [original, downloaded] = await Promise.all([
  hashStream(createReadStream(originalPath)),
  hashStream(downloadResponse.body),
]);
const metadataChecks = {
  fileId: metadata.$id === fileId,
  filename: metadata.name === basename(originalPath),
  originalSize: Number(metadata.sizeOriginal) === originalStat.size,
  downloadedSize: downloaded.bytes === originalStat.size,
};
if (expectedMimeArg) {
  const normalizeMime = value => {
    const mime = value.split(';', 1)[0].trim().toLowerCase();
    return mime === 'application/x-zip-compressed' ? 'application/zip' : mime;
  };
  metadataChecks.mimeType = normalizeMime(metadata.mimeType || '') === normalizeMime(expectedMimeArg);
}
const hashMatches = original.sha256 === downloaded.sha256;
console.log(JSON.stringify({
  metadataChecks,
  originalBytes: original.bytes,
  downloadedBytes: downloaded.bytes,
  originalSha256: original.sha256,
  downloadedSha256: downloaded.sha256,
  'Original SHA-256 === Downloaded SHA-256': hashMatches,
}, null, 2));
if (Object.values(metadataChecks).some(value => !value) || !hashMatches) process.exitCode = 1;
