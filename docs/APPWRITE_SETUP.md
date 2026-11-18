# Appwrite Storage setup

1. Create an Appwrite account, then a project named **SRUXHUB** in a region close to the users.
2. Storage → Create bucket. Set the display name to `sruxhub-uploads`, record the bucket ID separately, and keep the bucket private. Do not enable public write access.
3. Configure an upload size limit of 4 MB or lower for the current Vercel Function proxy. Allow image formats (JPEG, PNG, WebP, GIF), PDF, and approved presentation/document formats. Block executable and HTML content. Revisit accepted types before launch.
4. Create a server API key with only the storage permissions needed for file create/read/delete. Store endpoint, project ID, API key and bucket ID in server environment variables. Never put the API key in a `VITE_` variable.
5. Supabase `files` records contain provider, bucket and file identifiers; binary content belongs in Appwrite. Downloads must go through an authenticated server endpoint that checks the Supabase user's permission before reading the private bucket.

Authenticated Vercel Functions are provided at `/api/files/upload` and `/api/files/{id}`. They verify Supabase bearer tokens, require community membership for upload/download, enforce a 4 MB limit and MIME/extension allowlists, keep Appwrite credentials server-side, and store metadata in Supabase. Do not enable public bucket access. Vercel Functions cap request bodies at 4.5 MB, so this proxy caps files at 4 MB. For larger files, replace the proxy flow with a direct-to-storage upload design before launch. Test with actual projects, add malware scanning and full signatures for accepted formats, configure rate limits, and verify cleanup and role authorization.
