# Environment variables

Copy `.env.example` to `.env.local` for local development. Set the server-only values in Vercel Project Settings → Environment Variables for Preview and Production.

| Variable | Runtime | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Browser build | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser build | Supabase publishable/anon key; protected data remains behind RLS |
| `SUPABASE_URL` | Server only | Supabase URL used by Vercel API handlers |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Authenticate Supabase sessions and manage file metadata; never expose to browser |
| `APPWRITE_ENDPOINT` | Server API and browser session configuration | Appwrite API endpoint; it is not a secret |
| `APPWRITE_PROJECT_ID` | Server API and browser session configuration | Appwrite project identifier; it is not a secret |
| `APPWRITE_API_KEY` | Server only | Provision Appwrite users, mint custom tokens, verify/delete private objects |
| `APPWRITE_BUCKET_ID` | Server API and browser session configuration | Private Appwrite bucket identifier; it is not a secret |

No new runtime variables are required. Never add a `VITE_` prefix to either service-role/API key. Rotate any key that has been committed or shared outside a trusted secret store.
