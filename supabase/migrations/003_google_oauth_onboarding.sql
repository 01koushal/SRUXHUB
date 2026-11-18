-- Google OAuth users choose a username after returning from Supabase Auth.
-- Safe to apply after 001/002 on fresh installs and existing deployments.
alter table public.profiles alter column username drop not null;
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;
update public.profiles
set onboarding_complete = true
where username is not null and char_length(trim(display_name)) between 1 and 60;

-- Remove the legacy auth trigger that silently used an email prefix as username.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create or replace function public.is_sru_google()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(coalesce(u.email, '')) ~ '^[^@]+@sru\.edu\.in$'
      and u.email_confirmed_at is not null
      and coalesce(u.raw_app_meta_data->>'provider', '') = 'google'
  )
$$;

create or replace function public.has_completed_onboarding()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.onboarding_complete
  )
$$;
revoke all on function public.is_sru_google() from public;
grant execute on function public.is_sru_google() to anon, authenticated;
revoke all on function public.has_completed_onboarding() from public;
grant execute on function public.has_completed_onboarding() to anon, authenticated;

drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert
  with check (user_id = auth.uid() and public.is_sru_google()
    and onboarding_complete and username is not null
    and username ~ '^[A-Za-z0-9_]{3,24}$'
    and char_length(trim(display_name)) between 1 and 60);
create policy profiles_self_update on public.profiles for update
  using (user_id = auth.uid() and public.is_sru_google())
  with check (user_id = auth.uid() and public.is_sru_google() and onboarding_complete
    and username ~ '^[A-Za-z0-9_]{3,24}$'
    and char_length(trim(display_name)) between 1 and 60);
grant update(onboarding_complete) on public.profiles to authenticated;

drop policy if exists communities_admin_insert on public.communities;
drop policy if exists communities_admin_update on public.communities;
create policy communities_admin_insert on public.communities for insert
  with check (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin());
create policy communities_admin_update on public.communities for update
  using (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin())
  with check (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin());

drop policy if exists members_self_join on public.community_members;
drop policy if exists members_self_leave on public.community_members;
drop policy if exists members_admin_manage on public.community_members;
create policy members_self_join on public.community_members for insert
  with check (user_id = auth.uid() and role = 'member'
    and public.is_sru_google() and public.has_completed_onboarding());
create policy members_self_leave on public.community_members for delete
  using (user_id = auth.uid() and role = 'member'
    and public.is_sru_google() and public.has_completed_onboarding());
create policy members_admin_manage on public.community_members for all
  using (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin())
  with check (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin());

drop policy if exists posts_member_create on public.posts;
drop policy if exists posts_owner_edit on public.posts;
drop policy if exists posts_owner_delete on public.posts;
create policy posts_member_create on public.posts for insert
  with check (author_id = auth.uid() and public.is_sru_google()
    and public.has_completed_onboarding()
    and exists(select 1 from public.community_members m
      where m.community_id = posts.community_id and m.user_id = auth.uid()));
create policy posts_owner_edit on public.posts for update
  using (public.is_sru_google() and public.has_completed_onboarding()
    and (author_id = auth.uid() or public.is_community_moderator(community_id) or public.is_admin()))
  with check (public.is_sru_google() and public.has_completed_onboarding()
    and (author_id = auth.uid() or public.is_community_moderator(community_id) or public.is_admin()));
create policy posts_owner_delete on public.posts for delete
  using (public.is_sru_google() and public.has_completed_onboarding()
    and (author_id = auth.uid() or public.is_community_moderator(community_id) or public.is_admin()));

drop policy if exists comments_create on public.comments;
drop policy if exists comments_update on public.comments;
drop policy if exists comments_delete on public.comments;
create policy comments_create on public.comments for insert
  with check (author_id = auth.uid() and public.is_sru_google()
    and public.has_completed_onboarding()
    and exists(select 1 from public.posts p join public.community_members m
      on m.community_id = p.community_id
      where p.id = comments.post_id and m.user_id = auth.uid()));
create policy comments_update on public.comments for update
  using (author_id = auth.uid() and public.is_sru_google() and public.has_completed_onboarding())
  with check (author_id = auth.uid() and public.is_sru_google() and public.has_completed_onboarding());
create policy comments_delete on public.comments for delete
  using ((author_id = auth.uid() or public.is_admin())
    and public.is_sru_google() and public.has_completed_onboarding());

drop policy if exists saved_private on public.saved_posts;
create policy saved_private on public.saved_posts for all
  using (user_id = auth.uid() and public.is_sru_google() and public.has_completed_onboarding())
  with check (user_id = auth.uid() and public.is_sru_google() and public.has_completed_onboarding());

create or replace function public.cast_post_vote(p_post_id uuid,p_value smallint)
returns void language plpgsql security definer set search_path=public as $$
declare old_value smallint;
begin
  if auth.uid() is null or not public.is_sru_google() or not public.has_completed_onboarding() then
    raise exception 'Complete sign-in with an @sru.edu.in Google account before voting';
  end if;
  if p_value not in (-1,0,1) then raise exception 'Invalid vote'; end if;
  perform 1 from public.posts where id=p_post_id and status='published' for update;
  if not found then raise exception 'Post unavailable'; end if;
  select value into old_value from public.votes where user_id=auth.uid() and post_id=p_post_id;
  if p_value=0 then
    delete from public.votes where user_id=auth.uid() and post_id=p_post_id;
    update public.posts set vote_score=vote_score-coalesce(old_value,0) where id=p_post_id;
  elsif old_value is null then
    insert into public.votes(user_id,post_id,value) values(auth.uid(),p_post_id,p_value);
    update public.posts set vote_score=vote_score+p_value where id=p_post_id;
  else
    update public.votes set value=p_value where user_id=auth.uid() and post_id=p_post_id;
    update public.posts set vote_score=vote_score+p_value-old_value where id=p_post_id;
  end if;
end $$;
revoke all on function public.cast_post_vote(uuid,smallint) from public;
grant execute on function public.cast_post_vote(uuid,smallint) to authenticated;

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (user_id=auth.uid() and public.is_sru_google() and public.has_completed_onboarding())
  with check (user_id=auth.uid() and public.is_sru_google() and public.has_completed_onboarding());

drop policy if exists files_read on public.files;
create policy files_read on public.files for select
  using (public.is_sru_google() and public.has_completed_onboarding() and (
    owner_id=auth.uid() or public.is_admin() or
    (visibility='community' and status='published' and exists(
      select 1 from public.community_members m
      where m.community_id=files.community_id and m.user_id=auth.uid())) or
    (visibility='community' and status='published' and exists(
      select 1 from public.post_attachments a join public.posts p on p.id=a.post_id
      where a.file_id=files.id and p.status='published'))));

drop policy if exists reports_submit on public.reports;
drop policy if exists reports_admin_read on public.reports;
drop policy if exists reports_admin_update on public.reports;
create policy reports_submit on public.reports for insert
  with check (reporter_id=auth.uid() and state='open' and reviewer_id is null
    and public.is_sru_google() and public.has_completed_onboarding());
create policy reports_admin_read on public.reports for select
  using (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin());
create policy reports_admin_update on public.reports for update
  using (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin())
  with check (public.is_sru_google() and public.has_completed_onboarding() and public.is_admin());
