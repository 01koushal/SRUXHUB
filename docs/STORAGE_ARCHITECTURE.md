# Storage architecture

Supabase stores authorization context and file metadata; Appwrite stores binary uploads. A future provider should implement an application-owned `StorageProvider` contract (`upload`, `download`, `delete`, `getMetadata`, preview access and file identifier) so UI components never build provider URLs.

The repository schema includes provider, bucket ID, provider file ID, MIME, size, community, category and checksum metadata. The browser uses `StorageProvider`; Appwrite upload/download/delete requests go through Vercel Functions that verify Supabase bearer tokens and community membership. Keep the bucket private. The current Vercel proxy caps uploads at 4 MB because Vercel Functions reject request payloads above 4.5 MB. It checks MIME, extension and several file signatures; add a direct-to-storage flow for larger files, full content inspection, malware scanning, and attachment linking before production. Do not trust a client-supplied user ID or attachment URL.
