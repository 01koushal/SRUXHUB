-- Direct browser-to-Appwrite upload authorization. Existing files and metadata
-- are preserved. The server owns this table through the service role.

alter table public.files drop constraint if exists files_file_size_check;
alter table public.files add constraint files_file_size_check
  check (file_size > 0 and file_size <= 314572800);

create table if not exists public.direct_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  storage_file_id text not null unique,
  appwrite_user_id text not null,
  original_filename text not null,
  mime_type text not null,
  total_size bigint not null check (total_size > 0 and total_size <= 314572800),
  status text not null default 'authorized' check (status in ('authorized', 'finalized', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists direct_upload_sessions_expiry_idx
  on public.direct_upload_sessions (status, expires_at);
alter table public.direct_upload_sessions enable row level security;
revoke all privileges on table public.direct_upload_sessions from public, anon, authenticated;
grant all privileges on table public.direct_upload_sessions to service_role;
notify pgrst, 'reload schema';
