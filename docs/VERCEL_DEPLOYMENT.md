# Vercel deployment

1. Import the existing repository into Vercel with the Vite preset, `npm install`, `npm run build`, and `dist` as output.
2. Apply any missing Supabase migrations through 010 in order. On an existing database, do not rerun applied migrations and do not run `supabase/reset_and_rebuild.sql`.
3. Add all seven variables listed in [Environment variables](ENVIRONMENT_VARIABLES.md) to the correct Vercel environments. Only the `VITE_` Supabase URL and publishable key are included in browser assets. Keep the Supabase service-role and Appwrite API keys server-only.
4. Configure the private Appwrite bucket per [Appwrite setup](APPWRITE_SETUP.md): File Security enabled, Create for Users, maximum file size `314572800` bytes, no public permissions, allowed material extensions, and each SRUXHUB origin registered as a Web platform.
5. Deploy a Preview. Test OAuth, onboarding, community membership, direct browser-to-Appwrite upload, progress, cancellation, retry, metadata publication, community downloads and owner/moderator deletion with real service accounts.
6. For production, configure the custom domain and DNS in Vercel. Set Supabase Site URL and redirect allowlist to the production origin; add intended Preview origins when needed.
7. After deployment, verify one real upload and download. Run the streaming SHA-256 tool from [Storage architecture](STORAGE_ARCHITECTURE.md) when byte integrity needs explicit verification. Do not claim 300 MiB support until a real 300 MiB browser upload and download pass with matching byte counts and hashes.

The local Vite adapter uses the same API handlers; `api/files/upload` is retained only as a retired compatibility route returning `410 Gone`. Existing Appwrite files and Supabase rows are not reset by these deployment steps.
