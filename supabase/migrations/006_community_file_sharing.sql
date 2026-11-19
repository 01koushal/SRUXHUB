-- Safe extension of the existing file metadata model. No existing rows or
-- Appwrite objects are deleted. Apply after migrations 001-005.

alter table public.files
  drop constraint if exists files_file_size_check;
alter table public.files
  add constraint files_file_size_check
  check (file_size > 0 and file_size <= 26214400);

-- The existing sha256 column is populated only after the server has completed
-- and hashed an Appwrite upload. The unique index closes concurrent-upload races.
-- Clear redundant fingerprints from older duplicate rows while retaining each
-- file record and binary; the oldest matching row keeps its fingerprint.
with ranked as (
  select id, row_number() over (
    partition by community_id, sha256 order by created_at, id
  ) as duplicate_rank
  from public.files
  where community_id is not null and sha256 is not null and status = 'published'
)
update public.files f set sha256 = null
from ranked r
where f.id = r.id and r.duplicate_rank > 1;

create unique index if not exists files_community_sha256_unique_idx
  on public.files (community_id, sha256)
  where community_id is not null and sha256 is not null and status = 'published';

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
create index if not exists files_community_filename_idx
  on public.files (community_id, original_filename)
  where status = 'published';

alter table public.file_upload_sessions enable row level security;
revoke all privileges on table public.file_upload_sessions from public, anon, authenticated;
grant all privileges on table public.file_upload_sessions to service_role;

create table if not exists public.file_votes (
  file_id uuid not null references public.files(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (file_id, user_id)
);

create index if not exists file_votes_user_id_idx on public.file_votes (user_id);
alter table public.file_votes enable row level security;
revoke all privileges on table public.file_votes from public, anon, authenticated;
grant select on table public.file_votes to authenticated;

drop policy if exists file_votes_read_community on public.file_votes;
create policy file_votes_read_community on public.file_votes for select to authenticated
  using (
    public.is_sru_google()
    and public.has_completed_onboarding()
    and exists (
      select 1 from public.files f
      join public.community_members m on m.community_id = f.community_id
      where f.id = file_votes.file_id and m.user_id = auth.uid()
    )
  );

create or replace function public.toggle_file_vote(p_file_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  already_voted boolean;
begin
  if auth.uid() is null or not public.is_sru_google() or not public.has_completed_onboarding() then
    raise exception 'Complete sign-in with an @sru.edu.in Google account before voting';
  end if;

  perform 1
  from public.files f
  join public.community_members m on m.community_id = f.community_id and m.user_id = auth.uid()
  where f.id = p_file_id and f.status = 'published' and f.visibility = 'community'
  for update of f;
  if not found then raise exception 'File unavailable or community membership required'; end if;

  select exists (
    select 1 from public.file_votes v where v.file_id = p_file_id and v.user_id = auth.uid()
  ) into already_voted;

  if already_voted then
    delete from public.file_votes where file_id = p_file_id and user_id = auth.uid();
    return false;
  end if;

  insert into public.file_votes (file_id, user_id) values (p_file_id, auth.uid());
  return true;
end;
$$;

revoke all on function public.toggle_file_vote(uuid) from public, anon, authenticated;
grant execute on function public.toggle_file_vote(uuid) to authenticated;

create or replace function public.list_community_files(
  p_community_id uuid default null,
  p_sort text default 'newest'
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
    f.created_at desc;
end;
$$;

revoke all on function public.list_community_files(uuid, text) from public, anon, authenticated;
grant execute on function public.list_community_files(uuid, text) to authenticated;

-- Google profile names are sourced from OAuth metadata and cannot be edited by
-- browser clients. Existing names are normalized to the provider value once.
update public.profiles p
set display_name = left(trim(coalesce(
  nullif(u.raw_user_meta_data->>'full_name', ''),
  nullif(u.raw_user_meta_data->>'name', ''),
  split_part(u.email, '@', 1),
  'SRU Student'
)), 60)
from auth.users u
where u.id = p.user_id;

create or replace function public.set_google_profile_display_name()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  provider_name text;
begin
  select left(trim(coalesce(
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    split_part(u.email, '@', 1),
    'SRU Student'
  )), 60)
  into provider_name
  from auth.users u
  where u.id = new.user_id;

  if provider_name is null then raise exception 'Google profile name is unavailable'; end if;
  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name then
    raise exception 'Google display name cannot be edited';
  end if;
  new.display_name := provider_name;
  return new;
end;
$$;

drop trigger if exists profiles_google_display_name on public.profiles;
create trigger profiles_google_display_name
  before insert or update of display_name on public.profiles
  for each row execute function public.set_google_profile_display_name();

revoke all on function public.set_google_profile_display_name() from public, anon, authenticated;
revoke update (display_name) on public.profiles from authenticated;
