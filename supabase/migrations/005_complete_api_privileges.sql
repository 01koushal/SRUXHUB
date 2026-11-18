-- Explicitly remove accidental broad API permissions on SRUXHUB tables.
revoke all privileges on table
  public.profiles,
  public.communities,
  public.community_members,
  public.posts,
  public.files,
  public.post_attachments,
  public.comments,
  public.votes,
  public.saved_posts,
  public.notifications,
  public.reports
from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage on type public.member_role, public.post_kind, public.content_status, public.report_reason
  to anon, authenticated;

-- Public browsing is limited by the existing SELECT RLS policies.
grant select on table public.profiles, public.communities, public.posts, public.comments
  to anon, authenticated;

-- Membership rows are private to their owner; role changes remain admin-policy only.
drop policy if exists members_public_read on public.community_members;
drop policy if exists members_read_own on public.community_members;
create policy members_read_own on public.community_members for select
  using ((user_id = auth.uid() and public.is_sru_google() and public.has_completed_onboarding())
    or (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin()));
grant select, delete on table public.community_members to authenticated;
grant insert (community_id) on table public.community_members to authenticated;
grant update (role) on table public.community_members to authenticated;

-- Authenticated SRU users can create and manage their own content; RLS checks ownership.
grant delete on table public.posts to authenticated;
grant insert (community_id, title, content, post_type) on table public.posts to authenticated;
grant update (title, content, post_type) on table public.posts to authenticated;
grant delete on table public.comments to authenticated;
grant insert (post_id, parent_comment_id, content) on table public.comments to authenticated;
grant update (content) on table public.comments to authenticated;

-- Saved-post upsert updates only its post key; user_id remains derived from auth.uid().
grant select, delete on table public.saved_posts to authenticated;
grant insert (post_id) on table public.saved_posts to authenticated;
grant update (post_id) on table public.saved_posts to authenticated;

-- The client reads eligible file metadata and its own notifications.
grant select on table public.files, public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
drop policy if exists notifications_private on public.notifications;
create policy notifications_private on public.notifications for select
  using (user_id = auth.uid() and public.is_sru_google() and public.has_completed_onboarding());

-- Reports are private to admins and may be submitted only by the authenticated user.
grant select on table public.reports to authenticated;
grant insert (reporter_id, post_id, comment_id, file_id, reported_user_id, reason, details)
  on table public.reports to authenticated;
grant update (state, reviewer_id, resolved_at) on table public.reports to authenticated;

-- Keep profile updates column-scoped and permit only the onboarding insert.
grant insert (user_id, username, display_name, onboarding_complete)
  on table public.profiles to authenticated;
grant update (username, display_name, avatar_file_id, bio, onboarding_complete)
  on table public.profiles to authenticated;

-- Public post SELECT policies call these SECURITY DEFINER helpers as anon too.
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
revoke all on function public.is_community_moderator(uuid) from public, anon, authenticated;
grant execute on function public.is_community_moderator(uuid) to anon, authenticated;
revoke all on function public.is_sru_google() from public, anon, authenticated;
grant execute on function public.is_sru_google() to anon, authenticated;
revoke all on function public.has_completed_onboarding() from public, anon, authenticated;
grant execute on function public.has_completed_onboarding() to anon, authenticated;
revoke all on function public.cast_post_vote(uuid, smallint) from public, anon, authenticated;
grant execute on function public.cast_post_vote(uuid, smallint) to authenticated;
