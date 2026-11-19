# Vercel deployment

1. Push this project to a GitHub repository you control.
2. In Vercel, choose **Add New → Project**, import the repository and keep Framework Preset **Vite**. Install command `npm install`, build command `npm run build`, output directory `dist`.
3. Add browser-safe `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Add the server-only Supabase and Appwrite variables listed in [Environment variables](ENVIRONMENT_VARIABLES.md) for the file functions. Set production, preview and development values deliberately.
4. Deploy a preview first. Confirm migrations 001–008 are applied, auth redirects include the preview domain when testing, and the feed uses real database rows. File uploads send sequential 3 MiB chunks through `/api/files/upload`; the server stages them into Appwrite's required 5 MiB provider chunks while keeping browser requests below the 4.5 MB function request-body limit. Set the Appwrite bucket maximum to at least 25 MiB.
5. For production, add `hub.srux.in` under Project → Settings → Domains. Follow the DNS records Vercel displays for that domain. Do not change unrelated SRUX DNS records. Wait for domain verification and TLS certificate issuance.
6. Set Supabase Site URL to `https://hub.srux.in`, add the production redirect allowlist, and redeploy after environment changes.
7. Verify `https://hub.srux.in`, Google sign-in/redirect, username onboarding, signout/session restoration, a non-SRU Google denial, community listing, RLS and mobile layout.

Vercel deployment is not launch-ready until the chunk upload, checksum duplicate check, votes, storage endpoints, and auth flows are verified with configured services. The local adapter is enabled only by Vite's development server; production continues to use the Vercel handlers in `api/files`.
