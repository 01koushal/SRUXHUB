-- Enroll completed profiles in the two general communities.
-- This runs only when onboarding is completed, not on login or page refresh.
create or replace function public.join_default_communities_after_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.onboarding_complete
    and (tg_op = 'INSERT' or not old.onboarding_complete) then
    insert into public.community_members (community_id, user_id, role)
    select c.id, new.user_id, 'member'::public.member_role
    from public.communities c
    where c.slug in ('general', 'college-life')
    on conflict (community_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.join_default_communities_after_onboarding() from public;

drop trigger if exists profiles_join_default_communities on public.profiles;
create trigger profiles_join_default_communities
  after insert or update of onboarding_complete on public.profiles
  for each row
  execute function public.join_default_communities_after_onboarding();

-- One-time backfill for users who finished onboarding before this migration.
-- The existing primary key and ON CONFLICT keep this safe to rerun.
insert into public.community_members (community_id, user_id, role)
select c.id, p.user_id, 'member'::public.member_role
from public.profiles p
cross join public.communities c
where p.onboarding_complete
  and c.slug in ('general', 'college-life')
on conflict (community_id, user_id) do nothing;
