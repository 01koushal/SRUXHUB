-- Appwrite Cloud requires 5 MiB nonfinal multipart chunks, while Vercel
-- Functions accept at most 4.5 MB request bodies. Keep browser requests at
-- 3 MiB and privately stage enough bytes for the server to send valid Appwrite
-- chunks. Existing upload sessions remain valid and no files are changed.

alter table public.file_upload_sessions
  add column if not exists received_offset bigint not null default 0,
  add column if not exists pending_bytes bytea not null default ''::bytea,
  add column if not exists upload_status text not null default 'receiving';

alter table public.file_upload_sessions
  drop constraint if exists file_upload_sessions_received_offset_check,
  add constraint file_upload_sessions_received_offset_check
    check (received_offset >= next_offset and received_offset <= total_size),
  drop constraint if exists file_upload_sessions_upload_status_check,
  add constraint file_upload_sessions_upload_status_check
    check (upload_status in ('receiving', 'stored', 'failed'));

-- Sessions created before this migration may contain a partial Appwrite object
-- written with the old 3 MiB protocol. Mark them failed so the API cleans them
-- up and asks the user to restart rather than appending corrupt data.
update public.file_upload_sessions
set received_offset = next_offset,
    pending_bytes = ''::bytea,
    upload_status = 'failed'
where received_offset = 0 and next_offset > 0;

notify pgrst, 'reload schema';
