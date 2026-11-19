# Appwrite Storage setup

1. Create an Appwrite project named **SRUXHUB** in a region close to students.
2. Create a private bucket named `sruxhub-uploads` and record its bucket ID. Do not enable public read or write access.
3. Set the bucket maximum file size to at least **25 MiB** (`26214400` bytes). Allow JPEG, PNG, WebP, GIF, PDF, PPT, PPTX, DOCX, and ZIP extensions. Block executable and HTML content.
4. Create a server API key with only the file storage read, write and delete permissions needed by the file handlers. Keep endpoint, project ID, API key and bucket ID in server-only environment variables. Never use a `VITE_` prefix.
5. Appwrite's REST API accepts resumable chunks up to 5 MB using `Content-Range` and `X-Appwrite-ID`. SRUXHUB sends 3 MiB chunks through `/api/files/upload` so each Vercel request stays below its request-body limit.
6. Apply `supabase/migrations/006_community_file_sharing.sql` after migrations 001–005, then apply `supabase/migrations/007_file_upload_sessions.sql`. This adds/repairs the private upload-session table, exact-content duplicate enforcement and file-vote data without deleting files or metadata.

The server verifies the Supabase bearer token, Google provider, verified `@sru.edu.in` address, completed profile and community membership for each upload chunk. It computes the SHA-256 hash from the completed Appwrite object before publishing metadata. Downloads, previews and deletes continue through `/api/files/{id}`. Incomplete sessions can be cancelled and stale sessions are cleaned during a later upload.

The frontend supports files up to 25 MiB per file, including ZIP. Supabase stores metadata and Appwrite stores the private binary. Live Appwrite/Vercel behavior still needs verification against the configured project before release; local tests use mocked service responses.
