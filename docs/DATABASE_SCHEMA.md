# Database schema

Migrations 001-005 establish profiles, communities, memberships, posts, files, attachments, comments, post votes, saved posts, notifications and reports, then apply RLS and least-privilege API grants. Migration 006 adds upload-session state, a community-scoped SHA-256 uniqueness rule, file votes, file sorting/listing RPCs and database enforcement of immutable Google display names. Migration 007 idempotently restores upload-session storage privileges, replaces the file-list RPC with bounded pages, and asks PostgREST to reload its schema cache. Migration 008 privately stages 3 MiB browser uploads until an Appwrite-valid 5 MiB provider chunk is ready. These migrations preserve existing file rows and Appwrite objects. The development reset script is destructive and is not part of a normal upgrade.

UUIDs identify rows. Auth user deletion cascades private memberships, votes, saves and notifications but preserves authored content where foreign keys restrict deletion. Appwrite owns file binaries; Supabase stores metadata. Community roles are enum-constrained and self-join permits only `member`; admin assignment requires a trusted project-owner SQL session.

## Data API access map

| Table | Anonymous | Authenticated client | Other access |
| --- | --- | --- | --- |
| `profiles` | Select public rows | Select; onboarding insert; update username and bio | Google display name comes from OAuth metadata |
| `communities` | Select public rows | Select public rows | Admin changes under RLS |
| `posts` | Select public rows | Select; create, edit, delete under ownership and membership policies | Post vote RPC |
| `comments` | Select public rows | Select; create, edit, delete under ownership and membership policies | Existing post-vote RPC |
| `community_members` | None | Select own membership, join, leave | Admin role changes under RLS |
| `saved_posts` | None | Select, save, unsave | Owner-scoped RLS |
| `notifications` | None | Select own rows; update `read_at` | Owner-scoped RLS |
| `files` | None | Select rows allowed by file RLS | Upload, download, preview and delete use authenticated Vercel handlers |
| `file_votes` | None | Select community vote rows | `toggle_file_vote` RPC verifies identity and membership |
| `file_upload_sessions` | None | None | Server role only; upload sessions are owner-scoped |
| `votes` | None | No direct table access | `cast_post_vote` RPC |
| `post_attachments` | None | No direct table access | Server authorization reads |
| `reports` | None | Submit reports; admins read/review | No report UI currently |

Post embeds use explicit foreign-key names declared in migration 001, including `posts_author_id_fkey`, `posts_community_id_fkey`, `comments_author_id_fkey`, and `files_owner_id_fkey`.

Migration 006 is still a starting schema, not a live policy certification. Apply it in a scratch project first, inspect policies and test operations as anonymous users, ordinary members and admins before production.
