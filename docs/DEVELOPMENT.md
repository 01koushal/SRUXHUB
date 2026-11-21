# Development

## Commands

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for browser code. Put server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `APPWRITE_*` values in an ignored local `.env` or `.env.local`. Vite's development adapter reads only its server-side allowlist into Node; never prefix secrets with `VITE_` or commit local env files.

`npm run dev` starts the Vite frontend and mounts the direct-upload and protected file handlers to the local development server. The legacy `/api/files/upload` byte route returns `410 Gone`. Production uses the same `/api/files/*` Vercel handlers.

## Structure

- `src/features/auth`: Supabase session provider, Google OAuth and profile onboarding.
- `src/features/posts/service.ts`: feed, create-post, vote and comment calls.
- `src/features/communities`: community browsing, membership and tabs.
- `src/features/files`: file listing, search, upload UI, preview and file votes.
- `src/storage/provider.ts`: chunked upload client and authenticated file API calls.
- `supabase/migrations`: schema, security functions, RLS and data migrations.
- `api`: server-only Vercel endpoints, also mounted by development-only Vite middleware.

## Current implementation and verification limits

The UI uses SRUX blue and white, a responsive desktop/mobile shell and the supplied SRUX logo. Community pages have Posts, Files and About tabs. Community files support name warnings, small-file SHA-256 duplicate blocking, search, newest/most-upvoted sorting, file upvotes, previews, downloads and confirmed owner deletion. Upload bytes go directly from the browser to Appwrite using the Web SDK's chunked upload; Vercel receives authorization and finalization JSON only. Larger uploads are not automatically re-downloaded to hash them.

Run `npm run typecheck`, `npm test`, and `npm run build` for local checks. These do not prove production OAuth, Supabase RLS, Appwrite bucket settings, or 300 MiB upload/download behavior; those need configured service credentials and a real browser integration run.

Unit and local route tests use mocked Supabase and Appwrite responses. They do not prove behavior against live OAuth, database policies, Appwrite bucket settings or Vercel. Apply migrations 006, 007 and 008 before testing those integrations. Malware scanning, report/admin moderation and post attachment composition remain unimplemented.
