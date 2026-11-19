# Supabase and Google sign-in setup

SRUXHUB uses Supabase Auth with Google OAuth as its only sign-in method. Email/password signup and login are not part of the app. Authenticated users can browse without an SRU account, but only a verified Google identity at `@sru.edu.in` with a completed SRUXHUB profile can participate.

## 1. Create the Supabase project

1. Create a Supabase project named **SRUXHUB**. Choose the closest available region to the majority of students (typically Mumbai or Singapore); store the database password securely.
2. In **Project Settings → API**, copy the Project URL and publishable key to `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in local `.env.local` and Vercel. The publishable key is browser-safe when RLS is enabled. Never expose the service-role key.

## 2. Configure Google OAuth

Follow the [Supabase Google provider guide](https://supabase.com/docs/guides/auth/social-login/auth-google) and [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls) alongside these project-specific settings.

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth client of type **Web application**.
2. Add the local app origin (for example `http://localhost:5173`) and production origin `https://hub.srux.in` to **Authorized JavaScript origins**. Add any Vercel preview origins you intend to use while testing.
3. In Supabase **Authentication → Providers → Google**, enable Google and copy the callback URL shown there.
4. Add that exact Supabase callback URL to Google’s **Authorized redirect URIs**. Copy the Google OAuth client ID and client secret into the Supabase Google provider settings. Keep the client secret in Supabase; it is not a Vite environment variable.
5. In Supabase **Authentication → URL Configuration**, set Site URL to `https://hub.srux.in`. Add `http://localhost:5173/**`, `https://hub.srux.in/**`, and the exact preview origins/patterns you use to the redirect allow list. The app sends the current site origin as `redirectTo`; Supabase only redirects to allowed URLs.
6. Disable the **Email** sign-in provider for this project. Keep Google as the only enabled interactive provider. Do not rely on Google’s `hd` parameter as access control: SRUXHUB and its database policies independently check the authenticated Google provider and exact `@sru.edu.in` domain.

The browser client persists sessions, refreshes them, and detects OAuth credentials on the redirect URL. Users choose a username after their first eligible Google sign-in. The display name is taken from Google and is immutable in the profile UI and database. A case-insensitive database uniqueness constraint rejects a taken username and asks the user to choose another; the app never silently invents a replacement.

## 3. Apply SQL migrations

In Supabase **SQL Editor**, create a query for each file and run these in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_security_functions_seed.sql`
3. `supabase/migrations/003_google_oauth_onboarding.sql`
4. `supabase/migrations/004_api_read_and_onboarding_grants.sql`
5. `supabase/migrations/005_complete_api_privileges.sql`
6. `supabase/migrations/006_community_file_sharing.sql`
7. `supabase/migrations/007_file_upload_sessions.sql`
8. `supabase/migrations/008_appwrite_chunk_staging.sql`
9. `supabase/migrations/009_direct_appwrite_uploads.sql`

Run all eight on a fresh project before enabling sign-in. Migration 003 removes the legacy email-derived profile trigger, adds onboarding state and applies OAuth/domain restrictions to participation policies. It marks existing complete profiles as onboarded, but old non-Google identities remain unable to participate. Migration 004 grants public community/feed/profile reads and profile onboarding access. Migration 005 applies least-privilege API grants. Migration 006 increases the file size constraint, adds chunk upload sessions, a race-safe community checksum index, file votes and the immutable Google-name trigger; it preserves file rows and Appwrite objects. Migration 007 safely repairs the upload-session table and refreshes PostgREST's schema cache. Migration 008 adds private staging fields so 3 MiB browser requests can be joined into Appwrite's required 5 MiB nonfinal chunks.

For an existing database that already ran migrations 001–005, apply migrations 006, 007 and 008 in order. If 006 and 007 were already applied, apply 008. Do not rerun earlier migrations and do not run `reset_and_rebuild.sql` for this upgrade; that script deletes application data.

### Optional development-only full reset

For a **disposable development project only**, run `supabase/reset_and_rebuild.sql` instead of running migrations 001–005 individually. It deletes all rows and rebuilds these SRUXHUB tables: `profiles`, `communities`, `community_members`, `posts`, `files`, `post_attachments`, `comments`, `votes`, `saved_posts`, `notifications`, and `reports`. It preserves Supabase Auth users, Supabase Storage infrastructure and unrelated public objects. It reseeds the ten default communities. Appwrite binary files are outside the database and remain in the bucket as unlinked objects; remove those separately if desired. Existing users will need to sign in again and complete onboarding, and you will need to reassign the first admin. **Review the script and confirm the selected Supabase project before running it.** Never run it against production or a database containing data you need.

The manual read grants for `communities`, `posts`, and `profiles` are incorporated. Do not restore a table-wide `GRANT UPDATE ON profiles`; migration 005 grants only the profile columns used by the app.

CLI alternative: use Supabase CLI migrations in a linked project if your team has adopted the CLI. These checked-in files are plain SQL; for this repo the SQL Editor sequence above is the direct setup path. Do not run a later migration before its prerequisites.

## 4. Verify configuration

1. Confirm the tables exist: `profiles`, `communities`, `community_members`, `posts`, `files`, `file_upload_sessions`, `file_votes`, `post_attachments`, `comments`, `votes`, `saved_posts`, `notifications`, and `reports`.
2. Confirm RLS is enabled. Migration 003 provides `is_sru_google()` and `has_completed_onboarding()` checks for protected writes; public feed/community reads stay available without login.
3. Start the app with `npm run dev`, select **Continue with Google**, and sign in with a verified `@sru.edu.in` account. Complete onboarding with an available username; the profile uses the Google display name. Sign out and sign in again to confirm the profile and session return.
4. Try a non-SRU Google account: Supabase may complete provider authentication, but SRUXHUB signs that session out and returns to public browsing. Database policies also deny protected writes for wrong-domain users or identities from another provider.
5. Check Auth URL allow list, Google callback URL, client ID/secret, browser origins, and provider status if OAuth returns an error. Never add service-role credentials to `VITE_` variables.

## 5. Assign the first admin

First complete OAuth onboarding for the intended verified SRU Google account. Then, as the project owner, replace the email below in SQL Editor and run it:

```sql
insert into public.community_members (community_id, user_id, role)
select c.id, p.user_id, 'admin'::public.member_role
from public.communities c
join public.profiles p on true
join auth.users u on u.id = p.user_id
where c.slug = 'general'
  and lower(u.email) = lower('verified-admin@sru.edu.in')
  and p.onboarding_complete
on conflict (community_id, user_id)
do update set role = 'admin';
```

Verify the result:

```sql
select u.email, c.slug, m.role
from public.community_members m
join auth.users u on u.id = m.user_id
join public.communities c on c.id = m.community_id
where m.role = 'admin';
```

Only use the trusted SQL Editor for this step. Do not add an admin promotion control to the client.
