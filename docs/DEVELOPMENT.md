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

`npm run dev` starts the Vite frontend and mounts `/api/files/upload` and `/api/files/:id` to the existing handlers. That adapter applies only to the development server. Production still uses the same `/api/files/*` Vercel handlers.

## Structure

- `src/features/auth`: Supabase session provider, Google OAuth and profile onboarding.
- `src/features/posts/service.ts`: feed, create-post, vote and comment calls.
- `src/features/communities`: community browsing, membership and tabs.
- `src/features/files`: file listing, search, upload UI, preview and file votes.
- `src/storage/provider.ts`: chunked upload client and authenticated file API calls.
- `supabase/migrations`: schema, security functions, RLS and data migrations.
- `api`: server-only Vercel endpoints, also mounted by development-only Vite middleware.

## Current implementation and verification limits

The UI uses SRUX blue and white, a responsive desktop/mobile shell and the supplied SRUX logo. Community pages have Posts, Files and About tabs. Profiles show the Google display name as read-only, allow username/bio changes and display community/post/file counts. Community files support exact-name warnings, database-backed SHA-256 duplicate blocking, search, newest/most-upvoted sorting, file upvotes, previews, downloads and owner deletion. Uploads are limited to 25 MiB, allow ZIP, and travel as 3 MiB chunks through the Vercel-compatible handler. The server hashes the completed Appwrite object and publishes Supabase metadata only after the duplicate check.

Unit and local route tests use mocked Supabase and Appwrite responses. They do not prove behavior against live OAuth, database policies, Appwrite bucket settings or Vercel. Apply migrations 006 and 007 before testing those integrations. Malware scanning, report/admin moderation and post attachment composition remain unimplemented.
