import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'vitest';
import { localFileApi } from './local-file-api.mjs';

test('Vite routes direct authorization and protected file APIs without accepting file bytes', async () => {
  const middleware = await registerMiddleware();
  await withServer(middleware, async base => {
    const retired = await fetch(`${base}/api/files/upload`, { method: 'POST', body: Buffer.alloc(5 * 1024 * 1024) });
    assert.equal(retired.status, 410);
    assert.match((await retired.json()).error, /retired/i);

    const direct = await fetch(`${base}/api/files/direct`, { method: 'POST' });
    assert.equal(direct.status, 401);
    assert.deepEqual(await direct.json(), { error: 'Sign in required.' });

    const file = await fetch(`${base}/api/files/file-123?metadata=1`);
    assert.equal(file.status, 401);
  });
});

async function registerMiddleware() {
  let middleware;
  await localFileApi().configureServer({
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
