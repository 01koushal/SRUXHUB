# Security notes

- Supabase Auth is the only user sign-in provider. The server verifies the supplied access token with Supabase and does not trust a browser-supplied user ID.
- Upload authorization checks SRU Google provider, verified `@sru.edu.in` email, completed onboarding and current community membership.
- Supabase service-role and Appwrite API keys stay in server environments. The browser receives only a short-lived Appwrite custom-token secret for the mapped user.
- Appwrite Storage must remain private with File Security enabled. Do not grant public, guest, Any, browser read, or browser delete access at bucket level.
- Supabase file metadata is server managed. Migration 010 revokes browser insert/update/delete so a client cannot forge an Appwrite file mapping. Existing read policies remain in place.
- File downloads verify community membership or the existing published attachment access rule. Deletion requires a matching metadata row, current community membership, and ownership or moderator/admin authority.
- Uploaded MIME type and extension are allowlisted. No malware scanner is currently configured. SHA-256 is calculated automatically only for files up to 5 MiB; larger uploads rely on Appwrite metadata checks until explicitly integrity-tested.
- Configure auth redirect allowlists, backups, rate limits, abuse monitoring, retention and incident response before launch.
