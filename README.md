# SRUXHUB

A community platform for SR University students. This repository contains a React, Vite and TypeScript application backed by Supabase Auth/Postgres and a Vercel server API boundary for Appwrite Storage.

## Start locally

1. Install Node.js 20.19+ or 22.12+ (Vite 8 requirement).
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and add the Supabase URL and publishable key.
4. Apply the SQL migrations in `supabase/migrations/` in filename order using Supabase SQL Editor.
5. Run `npm run dev` and open the URL printed by Vite.

Without credentials the app shows honest setup and empty states; it does not invent sample feed activity. See [Development](docs/DEVELOPMENT.md), [Supabase setup](docs/SUPABASE_SETUP.md), [Appwrite setup](docs/APPWRITE_SETUP.md), and [Vercel deployment](docs/VERCEL_DEPLOYMENT.md).

## Current scope

Implemented foundation: responsive light/dark shell, Supabase email/password auth and recovery, database-driven feed/search, communities and membership, post creation/detail, comments, voting, saved posts, file library uploads through authenticated Vercel endpoints, Appwrite storage abstraction, initial communities, SQL policies and setup documentation. Profile editing, notifications UI, report/moderation tools, attachment composition, full pagination and live integration verification remain before production; see [known gaps](docs/DEVELOPMENT.md#known-gaps). This is not yet ready to advertise as a complete production platform.
