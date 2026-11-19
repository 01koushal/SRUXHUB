import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const serverEnvironmentKeys = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'APPWRITE_API_KEY',
  'APPWRITE_BUCKET_ID',
];

export function localFileApi(envFile = {}) {
  return {
    name: 'sruxhub-local-file-api',
    apply: 'serve',
    async configureServer(server) {
      // Copy only server-side credentials into Node. Never expose them to Vite's client bundle.
      for (const key of serverEnvironmentKeys) {
        if (!process.env[key] && envFile[key]) process.env[key] = envFile[key];
      }
      const missing = serverEnvironmentKeys.filter(key => !process.env[key]);
      if (missing.length) {
        server.config.logger.warn(`Local file API is missing server variables: ${missing.join(', ')}`);
      }

      const uploadModule = pathToFileURL(resolve(server.config.root, 'api/files/upload.mjs')).href;
      const directModule = pathToFileURL(resolve(server.config.root, 'api/files/direct.mjs')).href;
      const fileModule = pathToFileURL(resolve(server.config.root, 'api/files/[id].mjs')).href;
      const [{ default: uploadHandler }, { default: directHandler }, { default: fileHandler }] = await Promise.all([
        import(uploadModule),
        import(directModule),
        import(fileModule),
      ]);

      server.middlewares.use((req, res, next) => {
        let requestUrl;
        try {
          requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        } catch {
          next();
          return;
        }

        const path = requestUrl.pathname;
        let handler;
        let id;

        if (path === '/api/files/upload') {
          handler = uploadHandler;
        } else if (path === '/api/files/direct') {
          handler = directHandler;
        } else {
          const match = path.match(/^\/api\/files\/([^/]+)\/?$/);
          if (!match || match[1] === 'upload') {
            next();
            return;
          }
          try {
            id = decodeURIComponent(match[1]);
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid file ID' }));
            return;
          }
          handler = fileHandler;
        }

        const query = Object.fromEntries(requestUrl.searchParams.entries());
        if (id) query.id = id;
        Object.assign(req, { query });

        Promise.resolve(handler(req, res)).catch(error => {
          const message = error instanceof Error ? error.message : String(error);
          server.config.logger.error(`[local file API] ${req.method} ${path} failed: ${message}`);
          if (res.headersSent) return res.destroy(error instanceof Error ? error : undefined);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Local file API request failed' }));
        });
      });
    },
  };
}
