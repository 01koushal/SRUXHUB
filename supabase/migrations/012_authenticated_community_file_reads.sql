-- Allow every eligible onboarded SRU Google user to read published,
-- community-visible files. Membership remains required for file voting,
-- uploads, and community interactions. Private files remain owner/admin only.
drop policy if exists files_read on public.files;
create policy files_read on public.files for select
  using (
    public.is_sru_google()
    and public.has_completed_onboarding()
    and (
      owner_id = auth.uid()
      or public.is_admin()
      or (
        visibility = 'community'
        and status = 'published'
        and (
          community_id is not null
          or exists (
            select 1
            from public.post_attachments a
            join public.posts p on p.id = a.post_id
            where a.file_id = files.id and p.status = 'published'
          )
        )
      )
    )
  );

-- Remove the membership filter from listing only; vote counts and vote
-- mutations remain subject to the existing file_votes RLS and RPC checks.
create or replace function public.list_community_files(
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
  order by
    case when p_sort = 'upvotes' then
      (select count(*) from public.file_votes v where v.file_id = f.id)
    end desc nulls last,
    f.created_at desc,
    f.id desc
  limit p_limit offset p_offset;
end;
$$;

notify pgrst, 'reload schema';
