# Supabase setup

1. Create a Supabase organization/project named **SRUXHUB**. Choose a region near the majority of SR University users (typically Mumbai or Singapore, depending on current project availability and latency). Set a strong, unique database password and store it in a password manager.
2. In Project Settings → API, copy the Project URL and publishable key into `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The publishable key is intended for browser use with RLS enabled. Never use the secret/service-role key in the frontend.
3. In SQL Editor, create a query and execute `supabase/migrations/001_initial_schema.sql`, then execute `supabase/migrations/002_security_functions_seed.sql`. Keep the files in numeric order. Review the scripts on a development project before production.
4. Auth → URL Configuration: set Site URL to your local Vite origin during local work and `https://hub.srux.in` for production. Add local and production redirect URLs, including `http://localhost:5173/**` and `https://hub.srux.in/**`.
5. Auth → Providers: enable Email. Configure SMTP before public launch. Set email confirmation according to university onboarding policy; signup creates the profile from auth metadata via a database trigger. Keep confirmation enabled for production.
6. Password recovery uses `/reset-password`; configure this redirect and add a password update screen before relying on recovery in production.
7. Verify Table Editor shows profiles, communities, community_members, posts, files, post_attachments, comments, votes, saved_posts, notifications and reports. `communities` is seeded with ten starter groups.
8. Confirm RLS is enabled on every app table and test policies using non-admin accounts. Never expose the service-role secret.

## Assign the first admin safely

First create and verify the intended account through the normal signup flow. Then, as the project owner, open SQL Editor and run this after replacing the email with the verified account:

```sql
insert into public.community_members (community_id, user_id, role)
select c.id, p.user_id, 'admin'::public.member_role
from public.communities c
join public.profiles p on true
join auth.users u on u.id = p.user_id
where c.slug = 'general'
  and lower(u.email) = lower('verified-admin@example.edu')
on conflict (community_id, user_id)
do update set role = 'admin';
```

Check that exactly the intended account was promoted:

```sql
select u.email, c.slug, m.role
from public.community_members m
join auth.users u on u.id = m.user_id
join public.communities c on c.id = m.community_id
where m.role = 'admin';
```

Run this only from the trusted Supabase project-owner SQL session. Do not expose a client-side admin setup button or service-role key.

CLI alternative: install Supabase CLI, link the project with `supabase link --project-ref <project-ref>`, then run `supabase db push` after importing/organizing migrations as a Supabase CLI project. This repository currently provides plain SQL migrations; SQL Editor is the direct supported method.

Troubleshooting: check URL/key spelling, allowed redirect URLs, email provider and SMTP logs. A duplicate username will fail profile creation; signup metadata must include a 3–24 character username of letters, numbers or underscore. Service-role credentials must never be supplied to Vite.
