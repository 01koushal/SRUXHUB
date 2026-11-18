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
