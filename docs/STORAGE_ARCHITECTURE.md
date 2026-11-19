# Storage architecture

Supabase owns authorization, upload-session state, file metadata and vote rows. Appwrite keeps the private file binaries. The browser communicates only with `/api/files/upload` and `/api/files/{id}`; server credentials never enter the Vite bundle.

## Upload flow

The browser sends sequential 3 MiB raw chunks to the existing upload handler. Every request is authenticated against Supabase and checked against the user's SRU Google profile and community membership. Appwrite reassembles the chunks using its REST `Content-Range` and `X-Appwrite-ID` protocol. Appwrite supports chunks up to 5 MB; keeping ours at 3 MiB also keeps multipart proxy requests below Vercel's 4.5 MB request limit. The first chunk creates a private upload session in Supabase. Sessions are restricted to the owner and community by the server, can be cancelled, and incomplete sessions older than 24 hours are cleaned during a later upload.

After Appwrite has the complete object, the server downloads it back, computes SHA-256 from the stored bytes, checks for an existing fingerprint in the same community, and only then inserts the published Supabase metadata row. A community/hash unique index rejects concurrent identical uploads. A duplicate's temporary Appwrite object is deleted; the API returns the existing file summary so the UI can link to it. Filename matching is a case-sensitive warning in the UI and never blocks different content.

The frontend validates supported extensions, MIME types and the 25 MB per-file size before upload. The server repeats type, extension, size, signature, account, onboarding and membership checks. ZIP is accepted only with a ZIP MIME type and ZIP signature. The accepted MIME types are images (JPEG/PNG/WebP/GIF), PDF, PPT/PPTX, DOCX, and ZIP.

## File access and votes

Downloads, previews and deletion use the existing authenticated `/api/files/{id}` handler. Binaries stay private in Appwrite. Supabase rows record Appwrite identifiers, community, owner, MIME, byte size, timestamps and the server-computed checksum. The community file list RPC returns database vote counts and the signed-in user's vote state, scoped to communities they joined. The vote RPC locks the target file and toggles the unique `(file_id, user_id)` row.

Apply migrations `006_community_file_sharing.sql`, `007_file_upload_sessions.sql` and `008_appwrite_chunk_staging.sql` after migrations 001–005 before using the file list, votes, or chunked uploads. They preserve existing file rows and objects, expand the size check, add/repair session and vote tables, and stage browser chunks into Appwrite-valid provider chunks.

The project does not currently scan for malware or inspect every accepted format's full binary structure. SHA-256 identifies byte-identical files only; it does not identify modified, visually similar, recompressed or re-ordered documents.
