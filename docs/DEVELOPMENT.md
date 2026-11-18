# Development

## Commands

```sh
npm install
npm run dev
npm run typecheck
npm run build
```

Copy `.env.example` to `.env.local`. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` belong in browser code. Never commit `.env.local` or expose service credentials in `VITE_` variables.

## Structure

- `src/features/auth`: Supabase session provider and email auth.
- `src/features/posts/service.ts`: feed, create-post, and vote repository calls.
- `src/features/communities/service.ts`: community and membership repository calls.
- `src/lib`: shared backend clients.
- `supabase/migrations`: schema, security functions, RLS and initial community seed.
- `api`: server-only endpoints (planned; keep Appwrite credentials server-side).

## Known gaps before production

The starter avoids fabricated content. Working paths include feed, community discovery/join/leave, auth, post creation/detail, comments/replies, voting RPC, save/unsave, post search, file uploads/downloads/deletes through authenticated server functions, and per-community file access. Still needed: real profile editing/avatar flow, notifications UI and mark-read, reports/admin moderation, attachment composition/linking from the post editor, dedicated community file filters/categories, cursor pagination, share action, stronger file signature/virus checks and broader automated integration/browser tests. The SQL has not been applied to a live Supabase project, and Appwrite/Vercel endpoints have not been exercised with configured credentials. Test on disposable services, inspect policies and verify all roles before production.

## Auth UX reference

The supplied Lost & Found archive was inspected. Its sign-in is a focused dialog with clear feedback and a simple “continue / keep browsing” choice. SRUXHUB adapts that compact, low-friction approach to the requested Supabase email/password signup, verification and recovery flow; it does not copy the reference project's Google OAuth backend.
