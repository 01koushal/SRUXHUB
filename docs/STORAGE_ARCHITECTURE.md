# Storage architecture

Supabase Auth remains the user identity provider. Supabase Postgres stores file metadata, community ownership and short-lived upload authorization records. Appwrite Storage stores private binary objects. The browser sends file bytes directly to Appwrite with the official Appwrite Web SDK; Vercel functions receive only small JSON authorization/finalization requests.

## Upload

1. The browser sends the selected file name, normalized MIME type, byte size and community ID with the current Supabase access token.
2. `api/files/direct.mjs` validates the Supabase user, SRU Google account, completed profile, community membership, allowed extension/MIME type and 314572800-byte limit.
3. The server maps the Supabase UUID deterministically to an Appwrite user ID, reuses or creates that Appwrite user, and issues a short-lived custom token. It records the exact file metadata and owner in `direct_upload_sessions`.
4. The browser clears any previous Appwrite `current` session for this Appwrite project, creates a session with the custom token, and calls `Storage.createFile`. The Web SDK handles chunked requests and reports progress. The new file receives only a temporary read permission for its mapped Appwrite user.
5. The server retrieves Appwrite metadata and checks file ID, sanitized name, size, MIME type and the temporary owner permission. It removes file permissions, then inserts the published Supabase metadata row using the authenticated Supabase user's ID. Appwrite API keys and Supabase service-role keys stay server-side.

The Appwrite bucket must have File Security enabled, Create granted to Users, no public permissions, and a maximum size of at least 314572800 bytes. The application additionally rejects files above that same limit.

Small files up to 5 MiB are downloaded once by the server after upload to calculate SHA-256 and preserve exact-content deduplication. Larger files are not fetched back automatically; their metadata has a null `sha256`. This avoids doubling Appwrite egress for large production uploads. The stored metadata checks do not claim byte-integrity verification. A full integrity verification requires calculating a hash of the original file and downloaded bytes and comparing them explicitly.

For an explicit operator-run integrity check, use `node --env-file=.env scripts/verify-appwrite-integrity.mjs <original-file-path> <appwrite-file-id> [original-mime-type]`. It streams the original and downloaded file through SHA-256 without buffering either full file and prints `Original SHA-256 === Downloaded SHA-256` together with byte-count and metadata checks. This check is optional and downloads the entire object, so it is not run automatically on production uploads.

## Access and cleanup

Appwrite remains private. Download and delete requests use the Supabase file metadata ID, then the server checks the authenticated SRU user, the corresponding metadata row and the current community access before contacting Appwrite with its server key. Non-owner deletion requires moderator/admin authority. Community members never receive Appwrite admin credentials or unrestricted file URLs.

Upload authorization rows are RLS enabled and inaccessible to browser roles. Only server routes use the service-role client. Expired or cancelled Appwrite objects are removed during later upload authorization requests; failed cleanup can leave an orphan until another cleanup attempt or manual review. Supabase file metadata is server managed so browser clients cannot forge a row that references an arbitrary Appwrite object.

Apply migrations 001–010 in order to a new database. On an existing database, apply only unapplied migrations; migration 010 is forward-only and does not delete rows or Appwrite objects.
