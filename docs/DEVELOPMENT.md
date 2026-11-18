# Development

## Commands

```sh
npm install
npm run dev
npm run typecheck
npm run build
```

Put the browser Supabase values (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`) and server values in your ignored local `.env` file. Vite loads `.env` and the mode-specific `.env.*` files for local development. The local file API reads only the server-side allowlist (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `APPWRITE_*`) in Node; never prefix these secrets with `VITE_` or commit a local env file.

Run `npm run dev` to start the frontend and local file API together. Vite's development-only middleware forwards `/api/files/upload` and `/api/files/:id` to the existing handlers in `api/files`. The handlers keep Appwrite storage and Supabase metadata behavior. Production builds do not include this middleware; Vercel continues to serve those same `/api/files/*` handlers.

## Structure

- `src/features/auth`: Supabase session provider and email auth.
- `src/features/posts/service.ts`: feed, create-post, and vote repository calls.
- `src/features/communities/service.ts`: community and membership repository calls.
- `src/lib`: shared backend clients.
- `supabase/migrations`: schema, security functions, RLS and initial community seed.
- `api`: server-only Vercel endpoints, also mounted by the Vite development middleware (keep Appwrite credentials server-side).

## Known gaps before production

The starter avoids fabricated content. Working paths include public browsing, Google OAuth, exact SRU-domain/provider checks, profile onboarding, community discovery/join/leave, post creation/detail, top-level comments and replies display, voting RPC, save/unsave, post search, and file upload/download/delete through authenticated server functions. Still needed: avatar flow, report/admin moderation, attachment composition/linking from the post editor, comment reply/edit/delete controls, dedicated file search/categories, cursor pagination, share action, stronger file signatures/virus checks and broader automated browser/integration tests. SQL and Google OAuth have not been exercised against live credentials. Test on disposable services, inspect policies and verify eligible and ineligible accounts before production.

## Auth UX reference

The supplied Lost & Found archive was inspected. SRUXHUB follows its Google sign-in button, account chooser, persisted Supabase session, redirect handling, and explicit “keep browsing” path. SRUXHUB uses its own post-login profile onboarding and RLS rules.
