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

Implemented foundation: SRUX blue/white responsive UI, Supabase Google OAuth with SRU-domain checks, username onboarding and immutable Google display names, community Posts/Files/About tabs, profile activity, file search/sorting/voting, and direct browser-to-Appwrite uploads using Supabase-authenticated, community-authorized sessions. Apply all migrations in order through 010. The application enforces a 300 MiB upload limit; real-service and 300 MiB browser verification are still required before claiming that limit is operational. See [Appwrite setup](docs/APPWRITE_SETUP.md), [Storage architecture](docs/STORAGE_ARCHITECTURE.md), and [Development](docs/DEVELOPMENT.md).
