# Database schema

`001_initial_schema.sql` creates profiles (one per completed SRUXHUB onboarding), communities, memberships/roles, posts, file metadata, attachment links, nested comments, one-vote-per-user targets, private saved posts, notifications and reports. `002_security_functions_seed.sql` adds feed indexes, timestamps, transactional post-vote RPC, RLS and ten initial communities. `003_google_oauth_onboarding.sql` removes the legacy email-derived profile trigger and constrains protected mutations to verified Google identities at `@sru.edu.in` with completed onboarding. `004_api_read_and_onboarding_grants.sql` grants public reads and profile onboarding access. `005_complete_api_privileges.sql` resets API privileges on these tables to the app's required least-privilege set and limits membership reads to the owner and admins. `reset_and_rebuild.sql` is the standalone development-only destructive alternative that rebuilds the schema from migrations 001–005.

UUIDs identify rows. Auth user deletion cascades private membership/saves/notifications but preserves authored content by restricting deletion; plan account erasure explicitly. Files are metadata only. Appwrite owns the binary objects. Community roles are enum-constrained and self-join permits only `member`; only existing admins can manage admin membership. There is intentionally no public admin bootstrap secret: use a trusted project-owner SQL session after verifying the target account and community membership.

## Data API access map

Migration 005 first revokes inherited/table-wide privileges on SRUXHUB tables, then grants only these direct client operations. RLS further limits rows and writes to the current eligible user:

| Table | Anonymous | Authenticated client | Other access |
| --- | --- | --- | --- |
| `profiles` | Select public rows | Select; insert onboarding fields; update profile fields only | — |
| `communities` | Select public rows | Select public rows | — |
| `posts` | Select public rows | Select; create, edit, and delete under owner and membership policies | — |
| `comments` | Select public rows | Select; create, edit, and delete under owner and membership policies | — |
| `community_members` | None | Select own memberships, join, leave; role updates | RLS permits role updates only for admins |
| `saved_posts` | None | Select, save, unsave; upsert can update only `post_id` | — |
| `notifications` | None | Select own rows; update only `read_at` | — |
| `files` | None | Select rows allowed by file RLS | Upload/download/delete use the authenticated Vercel API and server-side service role |
| `votes` | None | No direct table access | Authenticated `cast_post_vote` RPC only |
| `post_attachments` | None | No direct table access | Server-side file authorization reads through service role |
| `reports` | None | Submit a report; read and review reports as admin | The current client has no report submission or review UI |

Post relationship hints match the default PostgreSQL foreign-key names declared by migration 001: `posts_author_id_fkey`, `posts_community_id_fkey`, and `comments_author_id_fkey`. Other embeds also name their foreign key explicitly to keep PostgREST relationships deterministic.

The migrations are a starting schema, not a certification. Run against a scratch database, inspect `pg_policies`, and test every operation as anonymous, ordinary member, moderator and admin before production.
