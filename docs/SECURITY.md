# Security notes

- Browser receives only Supabase URL and publishable key. RLS is the authorization boundary for direct Postgres access.
- Service role and Appwrite API keys are server-only secrets.
- Signup metadata is copied to a profile by a security-definer trigger. RLS prevents self-assignment of privileged membership roles.
- Posts and comments have bounded lengths; reports are visible only to admins.
- Appwrite bucket must remain private. Authenticated upload/download endpoints and file scanning are still required before accepting uploads.
- Review SQL functions and RLS against a nonproduction project. The initial seed creates communities but no fabricated posts or users.
- Configure SMTP, rate limits, abuse monitoring, backup/restore, data retention and an incident response process before launch.
