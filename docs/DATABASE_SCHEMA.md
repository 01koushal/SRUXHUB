# Database schema

`001_initial_schema.sql` creates profiles (one per completed SRUXHUB onboarding), communities, memberships/roles, posts, file metadata, attachment links, nested comments, one-vote-per-user targets, private saved posts, notifications and reports. `002_security_functions_seed.sql` adds feed indexes, timestamps, transactional post-vote RPC, RLS and ten initial communities. `003_google_oauth_onboarding.sql` removes the legacy email-derived profile trigger and constrains protected mutations to verified Google identities at `@sru.edu.in` with completed onboarding.

UUIDs identify rows. Auth user deletion cascades private membership/saves/notifications but preserves authored content by restricting deletion; plan account erasure explicitly. Files are metadata only. Appwrite owns the binary objects. Community roles are enum-constrained and self-join permits only `member`; only existing admins can manage admin membership. There is intentionally no public admin bootstrap secret: use a trusted project-owner SQL session after verifying the target account and community membership.

The migrations are a starting schema, not a certification. Run against a scratch database, inspect `pg_policies`, and test every operation as anonymous, ordinary member, moderator and admin before production.
