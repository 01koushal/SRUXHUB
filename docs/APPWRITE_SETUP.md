# Appwrite setup

1. Create or select the SRUXHUB Appwrite project and choose a region near the users.
2. Create a private Storage bucket and record its bucket ID. Do not grant read, update, delete, or any permissions to `Any` or `Guests`.
3. Enable **File Security**. Grant bucket **Create** permission to **Users**. Set **Maximum file size** to at least `314572800` bytes (300 MiB). Configure allowed extensions to include `jpg`, `jpeg`, `png`, `webp`, `gif`, `pdf`, `ppt`, `pptx`, `doc`, `docx`, `xls`, `xlsx`, `zip`, `txt`, `md`, and `csv`. Block executable and HTML formats.
4. Create a server API key with the Storage file read/write/delete and Users read/write scopes. Store it only as `APPWRITE_API_KEY` in the server environment. The API key provisions the deterministic Appwrite identity and custom token; it is never sent to browser code.
5. Add each deployed SRUXHUB origin as an Appwrite Web platform so the official Web SDK requests pass Appwrite origin checks.
6. Configure the seven variables in `.env.example`. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are browser-safe. Use Vercel environment settings for production; do not commit `.env` files.

Appwrite identity IDs are derived from the authenticated Supabase user UUID. Existing identities are reused rather than creating a temporary user per upload. Upload file permission is temporarily scoped to that Appwrite user and removed at finalization. Downloads and deletes continue through authenticated SRUXHUB API routes.

## Verify in Appwrite Console

- Bucket maximum file size is at least 300 MiB.
- File Security is enabled and Create for Users is present.
- No public, guest, or unrestricted file permissions are present.
- The Appwrite Web platform lists the local and deployed SRUXHUB origins.
- The API key scopes include Users read/write and Storage file read/write/delete.

Do not report 300 MiB support as verified until a real 300 MiB browser upload and download have both completed and their byte counts and SHA-256 hashes have matched.
