# Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Browser build | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser build | Supabase publishable/anon key; protected by RLS |
| `SUPABASE_URL` | Server only | Project URL for Vercel Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged server operations; never expose to browser |
| `APPWRITE_ENDPOINT` | Server only | Appwrite API endpoint |
| `APPWRITE_PROJECT_ID` | Server only | Appwrite project identifier |
| `APPWRITE_API_KEY` | Server only | Server API key, narrowly scoped |
| `APPWRITE_BUCKET_ID` | Server only | Configured bucket identifier (not its display name) |

Use `.env.local` for local development, and Vercel Project Settings → Environment Variables for deployed environments. Rotate any secret accidentally committed or shared.
