import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, test } from 'vitest';
import { UPLOAD_CHUNK_BYTES } from '../src/storage/provider.ts';
import { localFileApi } from './local-file-api.mjs';

const environment = new Map();
afterEach(() => {
  for (const [key, original] of environment) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  environment.clear();
});

test('local adapter forwards upload and file routes to the handlers', async () => {
  const middleware = await registerMiddleware();
  await withServer(middleware, async base => {
    const uploadResponse = await fetch(`${base}/api/files/upload`, { method: 'POST' });
    assert.equal(uploadResponse.status, 401);
    assert.deepEqual(await uploadResponse.json(), { error: 'Sign in required.' });

    const fileResponse = await fetch(`${base}/api/files/file-123?metadata=1`);
    assert.equal(fileResponse.status, 401);
    assert.deepEqual(await fileResponse.json(), { error: 'Sign in required' });
  });
});

test('accepts a multi-chunk PDF through Vite, Appwrite and Supabase metadata', async () => {
  const nativeFetch = globalThis.fetch;
  const backend = createBackendMock();
  globalThis.fetch = backend.fetch;
  setServerEnvironment();
  try {
    const middleware = await registerMiddleware();
    await withServer(middleware, async base => {
      const bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 17, 0x61);
      Buffer.from('%PDF-').copy(bytes);
      const headers = uploadHeaders({ name: 'notes.pdf', mime: 'application/pdf', size: bytes.length });
      const first = await nativeFetch(`${base}/api/files/upload`, {
        method: 'POST', headers: { ...headers, 'X-Upload-Action': 'start' },
        body: bytes.subarray(0, UPLOAD_CHUNK_BYTES),
      });
      assert.equal(first.status, 200);
      const { uploadSessionId, nextOffset } = await first.json();
      assert.equal(nextOffset, UPLOAD_CHUNK_BYTES);

      const second = await nativeFetch(`${base}/api/files/upload`, {
        method: 'POST', headers: { ...headers, 'X-Upload-Action': 'chunk', 'X-Upload-Session': uploadSessionId },
        body: bytes.subarray(UPLOAD_CHUNK_BYTES),
      });
      const secondBody = await second.json();
      assert.equal(second.status, 201, JSON.stringify(secondBody));
      const file = secondBody;
      assert.equal(file.name, 'notes.pdf');
      assert.equal(file.size, bytes.length);
      assert.equal(file.provider, 'appwrite');
      assert.equal(backend.completedUploads, 1);
      assert.equal(backend.lastRange, `bytes ${UPLOAD_CHUNK_BYTES}-${bytes.length - 1}/${bytes.length}`);
      assert.equal(backend.files[0].sha256, backend.sha256(bytes));
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('blocks same-community identical bytes, but permits them in another community', async () => {
  const nativeFetch = globalThis.fetch;
  const backend = createBackendMock();
  globalThis.fetch = backend.fetch;
  setServerEnvironment();
  try {
    const middleware = await registerMiddleware();
    await withServer(middleware, async base => {
      const bytes = Buffer.from('%PDF-identical paper');
      const first = await uploadSmall(nativeFetch, base, bytes, 'Maths.pdf', 'community-123');
      assert.equal(first.status, 201);

      const sameCommunity = await uploadSmall(nativeFetch, base, bytes, 'WhatsApp Document.pdf', 'community-123');
      assert.equal(sameCommunity.status, 409);
      const conflict = await sameCommunity.json();
      assert.equal(conflict.error, 'This exact file has already been shared in this community.');
      assert.equal(conflict.existingFile.id, 'metadata-1');

      const otherCommunity = await uploadSmall(nativeFetch, base, bytes, 'Shared Again.pdf', 'community-456');
      assert.equal(otherCommunity.status, 201);
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('accepts a correctly signed ZIP and cancels an incomplete upload', async () => {
  const nativeFetch = globalThis.fetch;
  const backend = createBackendMock();
  globalThis.fetch = backend.fetch;
  setServerEnvironment();
  try {
    const middleware = await registerMiddleware();
    await withServer(middleware, async base => {
      const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);
      const uploaded = await uploadSmall(nativeFetch, base, zip, 'resources.zip', 'community-123', 'application/zip');
      assert.equal(uploaded.status, 201);
      assert.equal((await uploaded.json()).mimeType, 'application/zip');

      const bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 2, 0x50);
      Buffer.from('%PDF-').copy(bytes);
      const first = await nativeFetch(`${base}/api/files/upload`, {
        method: 'POST',
        headers: { ...uploadHeaders({ name: 'cancel.pdf', mime: 'application/pdf', size: bytes.length }), 'X-Upload-Action': 'start' },
        body: bytes.subarray(0, UPLOAD_CHUNK_BYTES),
      });
      const session = await first.json();
      const cancel = await nativeFetch(`${base}/api/files/upload`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'X-Upload-Action': 'cancel', 'X-Upload-Session': session.uploadSessionId },
      });
      assert.equal(cancel.status, 200);
      assert.equal(backend.sessions.size, 0);
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('rejects and cleans an expired upload session', async () => {
  const nativeFetch = globalThis.fetch;
  const backend = createBackendMock();
  globalThis.fetch = backend.fetch;
  setServerEnvironment();
  try {
    const middleware = await registerMiddleware();
    await withServer(middleware, async base => {
      const bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 2, 0x61);
      Buffer.from('%PDF-').copy(bytes);
      const first = await nativeFetch(`${base}/api/files/upload`, {
        method: 'POST',
        headers: { ...uploadHeaders({ name: 'expired.pdf', mime: 'application/pdf', size: bytes.length }), 'X-Upload-Action': 'start' },
        body: bytes.subarray(0, UPLOAD_CHUNK_BYTES),
      });
      const session = await first.json();
      backend.sessions.get(session.uploadSessionId).created_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

      const result = await nativeFetch(`${base}/api/files/upload`, {
        method: 'POST',
        headers: { ...uploadHeaders({ name: 'expired.pdf', mime: 'application/pdf', size: bytes.length }),
          'X-Upload-Action': 'chunk', 'X-Upload-Session': session.uploadSessionId },
        body: bytes.subarray(UPLOAD_CHUNK_BYTES),
      });
      assert.equal(result.status, 410);
      assert.match((await result.json()).error, /session expired/i);
      assert.equal(backend.sessions.size, 0);
      assert.equal(backend.storedFiles.size, 0);
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('copies only allowlisted server environment values from local env', async () => {
  const original = process.env.APPWRITE_API_KEY;
  environment.set('APPWRITE_API_KEY', original);
  delete process.env.APPWRITE_API_KEY;
  const middleware = await registerMiddleware({ APPWRITE_API_KEY: 'local-test-key', VITE_TEST_ONLY: 'ignored' });
  assert.equal(process.env.APPWRITE_API_KEY, 'local-test-key');
  assert.equal(process.env.VITE_TEST_ONLY, undefined);
  assert.equal(typeof middleware, 'function');
});

async function uploadSmall(nativeFetch, base, bytes, name, communityId, mime = 'application/pdf') {
  return nativeFetch(`${base}/api/files/upload`, {
    method: 'POST',
    headers: { ...uploadHeaders({ name, mime, size: bytes.length }, communityId), 'X-Upload-Action': 'start' },
    body: bytes,
  });
}

function uploadHeaders({ name, mime, size }, communityId = 'community-123') {
  return {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/octet-stream',
    'X-File-Name': encodeURIComponent(name),
    'X-File-Mime': mime,
    'X-File-Size': String(size),
    'X-Community-Id': communityId,
  };
}

function setServerEnvironment() {
  const values = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    APPWRITE_ENDPOINT: 'https://appwrite.test/v1',
    APPWRITE_PROJECT_ID: 'test-project',
    APPWRITE_API_KEY: 'test-appwrite-key',
    APPWRITE_BUCKET_ID: 'test-bucket',
  };
  for (const [key, value] of Object.entries(values)) {
    if (!environment.has(key)) environment.set(key, process.env[key]);
    process.env[key] = value;
  }
}

async function registerMiddleware(envFile = {}) {
  let middleware;
  await localFileApi(envFile).configureServer({
    config: { root: process.cwd(), logger: { warn() {}, error() {} } },
    middlewares: { use(callback) { middleware = callback; } },
  });
  assert.equal(typeof middleware, 'function');
  return middleware;
}

async function withServer(middleware, callback) {
  const server = createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404;
    res.end('not found');
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function createBackendMock() {
  const sessions = new Map();
  const storedFiles = new Map();
  const files = [];
  let sessionSequence = 0;
  let fileSequence = 0;
  let completedUploads = 0;
  let lastRange = '';

  async function fetchMock(input, init = {}) {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init.method || (input instanceof Request ? input.method : 'GET');
    if (url.hostname === 'supabase.test' && url.pathname === '/auth/v1/user') {
      return Response.json({
        id: 'user-123', email: 'student@sru.edu.in', email_confirmed_at: '2026-01-01T00:00:00Z',
        app_metadata: { provider: 'google' },
      });
    }
    if (url.hostname === 'supabase.test' && url.pathname.endsWith('/profiles')) {
      return Response.json({ onboarding_complete: true });
    }
    if (url.hostname === 'supabase.test' && url.pathname.endsWith('/community_members')) {
      return Response.json({ community_id: url.searchParams.get('community_id')?.replace('eq.', '') });
    }
    if (url.hostname === 'supabase.test' && url.pathname.endsWith('/file_upload_sessions')) {
      if (method === 'GET') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        return Response.json(id ? sessions.has(id) ? sessions.get(id) : [] : []);
      }
      if (method === 'POST') {
        const body = JSON.parse(init.body);
        const row = { ...body, id: `00000000-0000-4000-8000-${String(++sessionSequence).padStart(12, '0')}`, created_at: new Date().toISOString() };
        sessions.set(row.id, row);
        return Response.json(row, { status: 201 });
      }
      if (method === 'PATCH') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        const row = sessions.get(id);
        const matches = row && [...url.searchParams.entries()]
          .filter(([key]) => key !== 'id' && key !== 'select')
          .every(([key, value]) => String(row[key]) === value.replace(/^eq\./, ''));
        if (matches) Object.assign(row, JSON.parse(init.body));
        return Response.json(matches ? row : []);
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        sessions.delete(id);
        return new Response(null, { status: 204 });
      }
    }
    if (url.hostname === 'supabase.test' && url.pathname.endsWith('/files')) {
      if (method === 'GET') {
        const hash = url.searchParams.get('sha256')?.replace('eq.', '');
        const communityId = url.searchParams.get('community_id')?.replace('eq.', '');
        const match = files.find(file => file.sha256 === hash && file.community_id === communityId && file.status === 'published');
        return Response.json(match ? [match] : []);
      }
      if (method === 'POST') {
        const body = JSON.parse(init.body);
        if (files.some(file => file.community_id === body.community_id && file.sha256 === body.sha256)) {
          return Response.json({ code: '23505', message: 'duplicate checksum' }, { status: 409 });
        }
        const row = {
          id: `metadata-${++fileSequence}`,
          ...body,
          status: 'published',
          created_at: new Date().toISOString(),
        };
        files.push(row);
        completedUploads++;
        return Response.json(row, { status: 201 });
      }
    }
    if (url.hostname === 'appwrite.test' && url.pathname.endsWith('/download') && method === 'GET') {
      const fileId = url.pathname.split('/').at(-2);
      const entry = storedFiles.get(fileId);
      return entry ? new Response(entry.bytes) : Response.json({ message: 'not found' }, { status: 404 });
    }
    if (url.hostname === 'appwrite.test' && url.pathname.endsWith('/files') && method === 'POST') {
      const form = init.body;
      const fileId = form.get('fileId');
      const blob = form.get('file');
      const bytes = Buffer.from(await blob.arrayBuffer());
      const range = init.headers['Content-Range'];
      lastRange = range || '';
      if (range) {
        const parsed = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!parsed) return Response.json({ message: 'bad range' }, { status: 400 });
        const [, start, end, total] = parsed.map(Number);
        let existing = storedFiles.get(fileId);
        if (!existing) {
          if (start !== 0) return Response.json({ message: 'first chunk must begin at zero' }, { status: 400 });
          existing = { bytes: Buffer.alloc(0), total, name: blob.name, mime: blob.type };
          storedFiles.set(fileId, existing);
        }
        if (start !== existing.bytes.length || end - start + 1 !== bytes.length || total !== existing.total) {
          return Response.json({ message: 'range mismatch' }, { status: 400 });
        }
        existing.bytes = Buffer.concat([existing.bytes, bytes]);
      } else {
        storedFiles.set(fileId, { bytes, total: bytes.length, name: blob.name, mime: blob.type });
      }
      return Response.json({ $id: fileId }, { status: 201 });
    }
    if (url.hostname === 'appwrite.test' && url.pathname.includes('/files/') && method === 'DELETE') {
      storedFiles.delete(url.pathname.split('/').at(-1));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
  }

  return {
    fetch: fetchMock,
    sessions,
    files,
    storedFiles,
    get completedUploads() { return completedUploads; },
    get lastRange() { return lastRange; },
  sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); },
  };
}
