# Vercel deployment

1. Push this project to a GitHub repository you control.
2. In Vercel, choose **Add New → Project**, import the repository and keep Framework Preset **Vite**. Install command `npm install`, build command `npm run build`, output directory `dist`.
3. Add browser-safe `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Add server-only Supabase and Appwrite variables from `.env.example` for the file functions. Set production, preview and development values deliberately.
4. Deploy a preview first. Confirm migrations are applied, auth redirects include the preview domain when testing, and the feed uses real database rows. Vercel Functions cap request bodies at 4.5 MB, so current uploads are limited to 4 MB per file.
5. For production, add `hub.srux.in` under Project → Settings → Domains. Follow the DNS records Vercel displays for that domain. Do not change unrelated SRUX DNS records. Wait for domain verification and TLS certificate issuance.
6. Set Supabase Site URL to `https://hub.srux.in`, add the production redirect allowlist, and redeploy after environment changes.
7. Verify `https://hub.srux.in`, signup/email confirmation, login, signout, community listing, RLS and mobile layout.

Vercel deployment is not launch-ready until the storage endpoints are verified with configured services and the remaining moderation, profile/avatar, and post attachment features are completed.
