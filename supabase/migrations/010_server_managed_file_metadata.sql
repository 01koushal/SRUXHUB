-- File metadata is created and changed only by authenticated server routes.
-- Browser clients retain read access under the existing RLS policies.
-- This prevents forged rows from pointing protected download routes at
-- arbitrary Appwrite file IDs. No existing rows or objects are changed.

revoke insert, update, delete on table public.files from anon, authenticated;

-- Upload session state is server-only. Explicit service-role policy documents
-- the intended path; ordinary client roles remain denied by grants and RLS.
alter table public.direct_upload_sessions enable row level security;
drop policy if exists direct_upload_sessions_service_role on public.direct_upload_sessions;
create policy direct_upload_sessions_service_role
  on public.direct_upload_sessions
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';
