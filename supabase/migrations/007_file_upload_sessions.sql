-- Idempotent repair for databases where the upload-session table is absent or
-- its service-role grants need restoring. No file rows or Appwrite objects are
-- changed. Apply migration 006 first for file voting and list_community_files.

create table if not exists public.file_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  storage_file_id text not null unique,
  original_filename text not null,
  mime_type text not null,
  total_size bigint not null check (total_size > 0 and total_size <= 26214400),
  next_offset bigint not null default 0 check (next_offset >= 0 and next_offset <= total_size),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists file_upload_sessions_created_at_idx
  on public.file_upload_sessions (created_at);
create index if not exists file_upload_sessions_owner_created_idx
  on public.file_upload_sessions (owner_id, created_at desc);

alter table public.file_upload_sessions enable row level security;
revoke all privileges on table public.file_upload_sessions from public, anon, authenticated;
grant all privileges on table public.file_upload_sessions to service_role;

-- Bound file-list responses and provide stable page offsets. The underlying
-- membership and row-security checks remain the same as migration 006.
drop function if exists public.list_community_files(uuid, text);
create function public.list_community_files(
  p_community_id uuid default null,
  p_sort text default 'newest',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  original_filename text,
  mime_type text,
  file_size bigint,
  storage_provider text,
  community_id uuid,
  community_name text,
  owner_id uuid,
  uploader_name text,
  uploader_username text,
  created_at timestamptz,
  upvote_count bigint,
  has_voted boolean
)
language plpgsql
stable
security invoker
set search_path = public, auth
as $$
begin
  if p_sort not in ('newest', 'upvotes') then raise exception 'Invalid file sort'; end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then raise exception 'Invalid file page'; end if;
  if auth.uid() is null or not public.is_sru_google() or not public.has_completed_onboarding() then
    raise exception 'Sign in with an eligible @sru.edu.in Google account to view community files';
  end if;

  return query
  select f.id, f.original_filename, f.mime_type, f.file_size, f.storage_provider,
    f.community_id, c.name, f.owner_id, p.display_name, p.username, f.created_at,
    (select count(*) from public.file_votes v where v.file_id = f.id),
    exists (select 1 from public.file_votes v where v.file_id = f.id and v.user_id = auth.uid())
  from public.files f
  join public.communities c on c.id = f.community_id
  join public.profiles p on p.user_id = f.owner_id
  where f.status = 'published'
    and f.visibility = 'community'
    and (p_community_id is null or f.community_id = p_community_id)
    and exists (
      select 1 from public.community_members m
      where m.community_id = f.community_id and m.user_id = auth.uid()
    )
  order by
    case when p_sort = 'upvotes' then
      (select count(*) from public.file_votes v where v.file_id = f.id)
    end desc nulls last,
    f.created_at desc,
    f.id desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.list_community_files(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_community_files(uuid, text, integer, integer) to authenticated;

-- PostgREST may have cached the schema while the table or 006 RPCs were absent.
notify pgrst, 'reload schema';
