# SRUXHUB

A community platform for SR University students. This repository contains a React, Vite and TypeScript application backed by Supabase Auth/Postgres and a Vercel server API boundary for Appwrite Storage.

## Start locally

1. Install Node.js 20.19+ or 22.12+ (Vite 8 requirement).
2. Run `npm install`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for browser code. Put Supabase service-role and Appwrite values in the ignored local `.env` or `.env.local`; never prefix server secrets with `VITE_`.
4. Apply the SQL migrations in `supabase/migrations/` in filename order using Supabase SQL Editor.
5. Run `npm run dev` and open the URL printed by Vite.

Without credentials the app shows honest setup and empty states; it does not invent sample feed activity. See [Development](docs/DEVELOPMENT.md), [Supabase setup](docs/SUPABASE_SETUP.md), [Appwrite setup](docs/APPWRITE_SETUP.md), and [Vercel deployment](docs/VERCEL_DEPLOYMENT.md).

## Current scope

Implemented foundation: SRUX blue/white responsive UI, Supabase Google OAuth with SRU-domain checks, username onboarding and immutable Google display names, community Posts/Files/About tabs, profile activity, file search/sorting/voting, ZIP support and chunked 25 MiB uploads through Vercel-compatible handlers. Apply migrations 006 and 007 for upload sessions, SHA-256 deduplication, file votes and profile-name enforcement. Live Supabase, Appwrite and Vercel integration verification is still required; see [Development](docs/DEVELOPMENT.md).
