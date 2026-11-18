import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'vitest';
import { localFileApi } from './local-file-api.mjs';

const changedEnvironment = new Map();
afterEach(() => {
  for (const [key, original] of changedEnvironment) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  changedEnvironment.clear();
});

test('dispatches local upload and file routes to the existing API handlers', async () => {
  const middleware = await registerMiddleware();
  const server = createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404;
    res.end('not found');
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const uploadResponse = await fetch(`${base}/api/files/upload`, { method: 'POST' });
    assert.equal(uploadResponse.status, 401);
    assert.deepEqual(await uploadResponse.json(), { error: 'Sign in required' });

    const fileResponse = await fetch(`${base}/api/files/file-123?metadata=1`);
    assert.equal(fileResponse.status, 401);
    assert.deepEqual(await fileResponse.json(), { error: 'Sign in required' });

    const otherResponse = await fetch(`${base}/api/other`);
    assert.equal(otherResponse.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('completes an authenticated upload through the local API adapter', async () => {
  const env = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    APPWRITE_ENDPOINT: 'https://appwrite.test/v1',
    APPWRITE_PROJECT_ID: 'test-project',
    APPWRITE_API_KEY: 'test-appwrite-key',
    APPWRITE_BUCKET_ID: 'test-bucket',
  };
  for (const [key, value] of Object.entries(env)) {
    changedEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'supabase.test' && url.pathname === '/auth/v1/user') {
      return Response.json({
        id: 'user-123',
        email: 'student@sru.edu.in',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        app_metadata: { provider: 'google' },
      });
    }
    if (url.hostname === 'supabase.test' && url.pathname.endsWith('/profiles')) {
      return Response.json({ onboarding_complete: true });
    }
    if (url.hostname === 'supabase.test' && url.pathname.endsWith('/community_members')) {
      return Response.json({ community_id: 'community-123' });
    }
    if (url.hostname === 'appwrite.test' && init.method === 'POST') {
      return Response.json({ $id: 'stored-file-123' }, { status: 201 });
    }
    if (url.hostname === 'supabase.test' && url.pathname.endsWith('/files') && init.method === 'POST') {
      return Response.json({
        id: 'metadata-123',
        original_filename: 'notes.pdf',
        mime_type: 'application/pdf',
        file_size: 12,
        storage_provider: 'appwrite',
      });
    }
    throw new Error(`Unexpected mocked request: ${init.method || 'GET'} ${url.pathname}`);
  };

  try {
    const middleware = await registerMiddleware();
    const server = createServer((req, res) => middleware(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const response = await originalFetch(`http://127.0.0.1:${address.port}/api/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-test-token',
          'Content-Type': 'application/pdf',
          'X-File-Name': 'notes.pdf',
          'X-Community-Id': 'community-123',
        },
        body: '%PDF-test file',
      });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), {
        id: 'metadata-123',
        name: 'notes.pdf',
        mimeType: 'application/pdf',
        size: 12,
        provider: 'appwrite',
      });
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loads only allowlisted server environment variables from the env file', async () => {
  const originalSecret = process.env.APPWRITE_API_KEY;
  changedEnvironment.set('APPWRITE_API_KEY', originalSecret);
  delete process.env.APPWRITE_API_KEY;
  const middleware = await registerMiddleware({ APPWRITE_API_KEY: 'test-server-secret', VITE_TEST_ONLY: 'ignored' });

  assert.equal(process.env.APPWRITE_API_KEY, 'test-server-secret');
  assert.equal(process.env.VITE_TEST_ONLY, undefined);
  assert.equal(typeof middleware, 'function');
});

async function registerMiddleware(envFile = {}) {
  let middleware;
  const plugin = localFileApi(envFile);
  await plugin.configureServer({
    config: {
      root: process.cwd(),
      logger: { warn() {}, error() {} },
    },
    middlewares: {
      use(callback) { middleware = callback; },
    },
  });
  assert.equal(typeof middleware, 'function');
  return middleware;
}
