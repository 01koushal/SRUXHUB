-- SRUXHUB DEVELOPMENT RESET ONLY. DESTRUCTIVE: deletes all SRUXHUB application data.
-- Preserves auth.users, Supabase Storage, extensions, and unrelated public objects.
-- Appwrite binary files are external and will remain as unlinked bucket objects.
-- Review the active Supabase project before executing this file.
begin;

-- Drop only known SRUXHUB application tables, child tables first. No CASCADE is used,
-- so unexpected dependencies stop the reset instead of deleting unrelated objects.
drop table if exists public.reports;
drop table if exists public.notifications;
drop table if exists public.saved_posts;
drop table if exists public.votes;
drop table if exists public.comments;
drop table if exists public.post_attachments;
drop table if exists public.files;
drop table if exists public.posts;
drop table if exists public.community_members;
drop table if exists public.communities;
drop table if exists public.profiles;

-- Remove application-owned helpers. This targets only the known legacy auth trigger
-- and public SRUXHUB functions; Auth users and all other Auth triggers are preserved.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.is_sru_google();
drop function if exists public.has_completed_onboarding();
drop function if exists public.is_community_moderator(uuid);
drop function if exists public.is_admin();
drop function if exists public.cast_post_vote(uuid, smallint);
drop function if exists public.set_updated_at();
drop function if exists public.refresh_community_member_count();
drop function if exists public.refresh_comment_count();
drop function if exists public.notify_new_comment();
drop function if exists public.validate_comment_parent();

-- Drop only SRUXHUB's application enums. Shared extensions are preserved.
drop type if exists public.report_reason;
drop type if exists public.content_status;
drop type if exists public.post_kind;
drop type if exists public.member_role;

-- Rebuild step 1: supabase/migrations/001_initial_schema.sql
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create type public.member_role as enum ('member','moderator','admin');
create type public.post_kind as enum ('discussion','question','resource','announcement','showcase');
create type public.content_status as enum ('published','removed','hidden');
create type public.report_reason as enum ('spam','harassment','inappropriate','misleading','copyright','other');
create table public.profiles(user_id uuid primary key constraint profiles_user_id_fkey references auth.users(id) on delete cascade,username text,username_key text generated always as (lower(username)) stored unique,display_name text not null default '',avatar_file_id text,bio text not null default '',onboarding_complete boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint profiles_username_check check(username ~ '^[A-Za-z0-9_]{3,24}$'),constraint profiles_display_name_check check(char_length(display_name)<=60),constraint profiles_bio_check check(char_length(bio)<=500));
create table public.communities(id uuid primary key default gen_random_uuid(),name text not null unique,slug text not null unique,description text not null default '',icon text,banner_file_id text,creator_id uuid constraint communities_creator_id_fkey references public.profiles(user_id) on delete set null,rules jsonb not null default '[]'::jsonb,member_count integer not null default 0 check(member_count>=0),created_at timestamptz not null default now());
create table public.community_members(community_id uuid constraint community_members_community_id_fkey references public.communities(id) on delete cascade,user_id uuid default auth.uid() constraint community_members_user_id_fkey references public.profiles(user_id) on delete cascade,role public.member_role not null default 'member',joined_at timestamptz not null default now(),primary key(community_id,user_id));
create table public.posts(id uuid primary key default gen_random_uuid(),community_id uuid not null constraint posts_community_id_fkey references public.communities(id) on delete restrict,author_id uuid not null default auth.uid() constraint posts_author_id_fkey references public.profiles(user_id) on delete restrict,title text not null,content text not null default '',post_type public.post_kind not null default 'discussion',status public.content_status not null default 'published',vote_score integer not null default 0,comment_count integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint post_title_check check(char_length(title) between 4 and 180),constraint post_content_check check(char_length(content)<=20000));
create table public.files(id uuid primary key default gen_random_uuid(),owner_id uuid not null constraint files_owner_id_fkey references public.profiles(user_id) on delete restrict,community_id uuid constraint files_community_id_fkey references public.communities(id) on delete restrict,storage_provider text not null check(storage_provider in ('appwrite','r2')),storage_file_id text not null,storage_bucket_id text not null,original_filename text not null,mime_type text not null,file_size bigint not null check(file_size>0 and file_size<=4194304),category text not null default 'attachment',description text not null default '',sha256 text,visibility text not null default 'community' check(visibility in ('community','private')),status public.content_status not null default 'published',created_at timestamptz not null default now(),unique(storage_provider,storage_bucket_id,storage_file_id));
create table public.post_attachments(post_id uuid constraint post_attachments_post_id_fkey references public.posts(id) on delete cascade,file_id uuid constraint post_attachments_file_id_fkey references public.files(id) on delete restrict,position smallint not null default 0,primary key(post_id,file_id));
create table public.comments(id uuid primary key default gen_random_uuid(),post_id uuid not null constraint comments_post_id_fkey references public.posts(id) on delete cascade,author_id uuid not null default auth.uid() constraint comments_author_id_fkey references public.profiles(user_id) on delete restrict,parent_comment_id uuid constraint comments_parent_comment_id_fkey references public.comments(id) on delete cascade,content text not null,status public.content_status not null default 'published',vote_score integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(char_length(content) between 1 and 10000));
create table public.votes(user_id uuid constraint votes_user_id_fkey references public.profiles(user_id) on delete cascade,post_id uuid constraint votes_post_id_fkey references public.posts(id) on delete cascade,comment_id uuid constraint votes_comment_id_fkey references public.comments(id) on delete cascade,value smallint not null check(value in (-1,1)),created_at timestamptz not null default now(),check((post_id is not null)::int+(comment_id is not null)::int=1),unique(user_id,post_id),unique(user_id,comment_id));
create table public.saved_posts(user_id uuid default auth.uid() constraint saved_posts_user_id_fkey references public.profiles(user_id) on delete cascade,post_id uuid constraint saved_posts_post_id_fkey references public.posts(id) on delete cascade,created_at timestamptz not null default now(),primary key(user_id,post_id));
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null constraint notifications_user_id_fkey references public.profiles(user_id) on delete cascade,actor_id uuid constraint notifications_actor_id_fkey references public.profiles(user_id) on delete set null,kind text not null check(kind in ('comment','reply','announcement','moderation')),post_id uuid constraint notifications_post_id_fkey references public.posts(id) on delete cascade,comment_id uuid constraint notifications_comment_id_fkey references public.comments(id) on delete cascade,message text not null default '',read_at timestamptz,created_at timestamptz not null default now());
create table public.reports(id uuid primary key default gen_random_uuid(),reporter_id uuid not null constraint reports_reporter_id_fkey references public.profiles(user_id) on delete restrict,post_id uuid constraint reports_post_id_fkey references public.posts(id) on delete cascade,comment_id uuid constraint reports_comment_id_fkey references public.comments(id) on delete cascade,file_id uuid constraint reports_file_id_fkey references public.files(id) on delete cascade,reported_user_id uuid constraint reports_reported_user_id_fkey references public.profiles(user_id) on delete cascade,reason public.report_reason not null,details text not null default '',state text not null default 'open' check(state in ('open','reviewing','resolved','dismissed')),reviewer_id uuid constraint reports_reviewer_id_fkey references public.profiles(user_id) on delete set null,created_at timestamptz not null default now(),resolved_at timestamptz,check((post_id is not null)::int+(comment_id is not null)::int+(file_id is not null)::int+(reported_user_id is not null)::int=1));

-- Rebuild step 2: supabase/migrations/002_security_functions_seed.sql
create index posts_feed_idx on public.posts(status,created_at desc);create index posts_popular_idx on public.posts(status,vote_score desc,created_at desc);create index posts_community_idx on public.posts(community_id,created_at desc);create index posts_title_search_idx on public.posts using gin(title gin_trgm_ops);create index posts_content_search_idx on public.posts using gin(content gin_trgm_ops);create index comments_post_idx on public.comments(post_id,created_at);create index files_visibility_idx on public.files(visibility,created_at desc);create index notifications_user_idx on public.notifications(user_id,created_at desc);create index reports_state_idx on public.reports(state,created_at);
create or replace function public.is_community_moderator(cid uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from community_members where community_id=cid and user_id=auth.uid() and role in ('moderator','admin'))$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from community_members where user_id=auth.uid() and role='admin')$$;
create or replace function public.cast_post_vote(p_post_id uuid,p_value smallint) returns void language plpgsql security definer set search_path=public as $$declare old_value smallint;begin if auth.uid() is null then raise exception 'Sign in to vote';end if;if p_value not in (-1,0,1) then raise exception 'Invalid vote';end if;perform 1 from posts where id=p_post_id and status='published' for update;if not found then raise exception 'Post unavailable';end if;select value into old_value from votes where user_id=auth.uid() and post_id=p_post_id; if p_value=0 then delete from votes where user_id=auth.uid() and post_id=p_post_id;update posts set vote_score=vote_score-coalesce(old_value,0) where id=p_post_id;elsif old_value is null then insert into votes(user_id,post_id,value) values(auth.uid(),p_post_id,p_value);update posts set vote_score=vote_score+p_value where id=p_post_id;else update votes set value=p_value where user_id=auth.uid() and post_id=p_post_id;update posts set vote_score=vote_score+p_value-old_value where id=p_post_id;end if;end$$;
create or replace function public.set_updated_at() returns trigger language plpgsql set search_path=public as $$begin new.updated_at=now();return new;end$$;create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();create trigger posts_updated before update on public.posts for each row execute function public.set_updated_at();create trigger comments_updated before update on public.comments for each row execute function public.set_updated_at();
alter table public.profiles enable row level security;alter table public.communities enable row level security;alter table public.community_members enable row level security;alter table public.posts enable row level security;alter table public.files enable row level security;alter table public.post_attachments enable row level security;alter table public.comments enable row level security;alter table public.votes enable row level security;alter table public.saved_posts enable row level security;alter table public.notifications enable row level security;alter table public.reports enable row level security;
create policy profiles_public_read on public.profiles for select using(true);create policy profiles_self_update on public.profiles for update using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy communities_public_read on public.communities for select using(true);create policy communities_admin_insert on public.communities for insert with check(public.is_admin());create policy communities_admin_update on public.communities for update using(public.is_admin()) with check(public.is_admin());
create policy members_public_read on public.community_members for select using(true);create policy members_self_join on public.community_members for insert with check(user_id=auth.uid() and role='member');create policy members_self_leave on public.community_members for delete using(user_id=auth.uid() and role='member');create policy members_admin_manage on public.community_members for all using(public.is_admin()) with check(public.is_admin());
create policy posts_read on public.posts for select using(status='published' or author_id=auth.uid() or public.is_community_moderator(community_id) or public.is_admin());create policy posts_member_create on public.posts for insert with check(author_id=auth.uid() and exists(select 1 from community_members m where m.community_id=posts.community_id and m.user_id=auth.uid()));create policy posts_owner_edit on public.posts for update using(author_id=auth.uid() or public.is_community_moderator(community_id) or public.is_admin()) with check(author_id=auth.uid() or public.is_community_moderator(community_id) or public.is_admin());create policy posts_owner_delete on public.posts for delete using(author_id=auth.uid() or public.is_community_moderator(community_id) or public.is_admin());
create policy comments_read on public.comments for select using(status='published' or author_id=auth.uid() or public.is_admin());create policy comments_create on public.comments for insert with check(author_id=auth.uid() and exists(select 1 from posts p join community_members m on m.community_id=p.community_id where p.id=post_id and m.user_id=auth.uid()));create policy comments_update on public.comments for update using(author_id=auth.uid() or public.is_admin()) with check(author_id=auth.uid() or public.is_admin());create policy comments_delete on public.comments for delete using(author_id=auth.uid() or public.is_admin());
create policy votes_read on public.votes for select using(user_id=auth.uid());
create policy saved_private on public.saved_posts for all using(user_id=auth.uid()) with check(user_id=auth.uid());create policy notifications_private on public.notifications for select using(user_id=auth.uid());create policy notifications_update on public.notifications for update using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy files_read on public.files for select using(owner_id=auth.uid() or public.is_admin() or (visibility='community' and status='published' and exists(select 1 from community_members m where m.community_id=files.community_id and m.user_id=auth.uid())) or (visibility='community' and status='published' and exists(select 1 from post_attachments a join posts p on p.id=a.post_id where a.file_id=files.id and p.status='published')));create policy files_owner_insert on public.files for insert with check(owner_id=auth.uid());create policy files_owner_update on public.files for update using(owner_id=auth.uid() or public.is_admin()) with check(owner_id=auth.uid() or public.is_admin());create policy files_owner_delete on public.files for delete using(owner_id=auth.uid() or public.is_admin());create policy attachments_read on public.post_attachments for select using(exists(select 1 from posts p where p.id=post_id and (p.status='published' or p.author_id=auth.uid())));create policy attachments_owner_insert on public.post_attachments for insert with check(exists(select 1 from posts p join files f on f.id=file_id where p.id=post_id and p.author_id=auth.uid() and f.owner_id=auth.uid()));create policy attachments_owner_delete on public.post_attachments for delete using(exists(select 1 from posts p where p.id=post_id and p.author_id=auth.uid()));
create policy reports_submit on public.reports for insert with check(reporter_id=auth.uid() and state='open' and reviewer_id is null);create policy reports_admin_read on public.reports for select using(public.is_admin());create policy reports_admin_update on public.reports for update using(public.is_admin()) with check(public.is_admin());

create or replace function public.refresh_community_member_count() returns trigger language plpgsql security definer set search_path=public as $$begin if tg_op='INSERT' then update communities set member_count=member_count+1 where id=new.community_id;return new;else update communities set member_count=greatest(member_count-1,0) where id=old.community_id;return old;end if;end$$;
create trigger community_members_count after insert or delete on public.community_members for each row execute function public.refresh_community_member_count();
create or replace function public.refresh_comment_count() returns trigger language plpgsql security definer set search_path=public as $$begin if tg_op='INSERT' and new.parent_comment_id is null then update posts set comment_count=comment_count+1 where id=new.post_id;return new;elsif tg_op='DELETE' and old.parent_comment_id is null then update posts set comment_count=greatest(comment_count-1,0) where id=old.post_id;return old;end if;return null;end$$;
create trigger comments_count after insert or delete on public.comments for each row execute function public.refresh_comment_count();
create or replace function public.notify_new_comment() returns trigger language plpgsql security definer set search_path=public as $$declare recipient uuid;begin if new.parent_comment_id is null then select author_id into recipient from posts where id=new.post_id;if recipient is not null and recipient<>new.author_id then insert into notifications(user_id,actor_id,kind,post_id,comment_id,message) values(recipient,new.author_id,'comment',new.post_id,new.id,'commented on your post');end if;else select author_id into recipient from comments where id=new.parent_comment_id;if recipient is not null and recipient<>new.author_id then insert into notifications(user_id,actor_id,kind,post_id,comment_id,message) values(recipient,new.author_id,'reply',new.post_id,new.id,'replied to your comment');end if;end if;return new;end$$;
create trigger comments_notify after insert on public.comments for each row execute function public.notify_new_comment();
create or replace function public.validate_comment_parent() returns trigger language plpgsql set search_path=public as $$begin if new.parent_comment_id is not null and not exists(select 1 from comments c where c.id=new.parent_comment_id and c.post_id=new.post_id) then raise exception 'Reply parent must belong to the same post';end if;return new;end$$;
create trigger comments_parent_check before insert or update of parent_comment_id,post_id on public.comments for each row execute function public.validate_comment_parent();
revoke all on function public.refresh_community_member_count() from public;revoke all on function public.refresh_comment_count() from public;revoke all on function public.notify_new_comment() from public;revoke all on function public.validate_comment_parent() from public;
revoke all on function public.is_admin() from public;grant execute on function public.is_admin() to authenticated;revoke all on function public.is_community_moderator(uuid) from public;grant execute on function public.is_community_moderator(uuid) to authenticated;revoke all on function public.cast_post_vote(uuid,smallint) from public;grant execute on function public.cast_post_vote(uuid,smallint) to authenticated;
revoke all on public.votes from anon,authenticated;grant select on public.votes to authenticated;
revoke update on public.posts from authenticated;grant update(title,content,post_type,status) on public.posts to authenticated;
revoke update on public.comments from authenticated;grant update(content,status) on public.comments to authenticated;
revoke update on public.profiles from authenticated;grant update(username,display_name,avatar_file_id,bio) on public.profiles to authenticated;
revoke update on public.notifications from authenticated;grant update(read_at) on public.notifications to authenticated;
revoke update on public.files from authenticated;
revoke insert,update,delete on public.files from anon,authenticated;
insert into public.communities(name,slug,description,rules) values
('AI/ML','ai-ml','Machine learning projects, concepts, papers and study groups.','[]'),('College Life','college-life','The everyday moments, questions and stories of campus life.','[]'),('DBMS','dbms','Database design, SQL, systems and exam preparation.','[]'),('DSA','dsa','Algorithms, data structures, coding practice and interview prep.','[]'),('General','general','Open conversations for the whole SR University community.','[]'),('Internships','internships','Internship leads, experiences, applications and advice.','[]'),('Memes','memes','Campus humor and memes. Keep it kind and within community guidelines.','[]'),('Placements','placements','Placement updates, preparation, referrals and experiences.','[]'),('Projects','projects','Showcase your work, find teammates and get feedback.','[]'),('Web Development','web-development','Frontend, backend, design systems and web projects.','[]');

-- Rebuild step 3: supabase/migrations/003_google_oauth_onboarding.sql
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

-- Rebuild step 4: supabase/migrations/004_api_read_and_onboarding_grants.sql
-- Explicit grants required for the browser's Supabase Data API queries.
-- Row-level security policies continue to control which rows each role sees.
grant select on table public.communities, public.posts, public.profiles
  to anon, authenticated;

-- Profile onboarding inserts a user-selected profile. RLS restricts the row
-- to the current verified SRU Google user and requires completed fields.
grant insert (user_id, username, display_name, onboarding_complete)
  on table public.profiles to authenticated;
revoke insert, update on table public.profiles from anon;

-- Remove any table-wide UPDATE grant (for example, one added during manual
-- testing) while retaining only the profile columns supported by the app.
revoke update on table public.profiles from authenticated;
grant update (username, display_name, avatar_file_id, bio, onboarding_complete)
  on table public.profiles to authenticated;

-- Rebuild step 5: supabase/migrations/005_complete_api_privileges.sql
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

commit;
