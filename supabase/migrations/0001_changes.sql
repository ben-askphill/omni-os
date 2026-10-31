-- Omni OS sync relay. Each Mac keeps its own SQLite as the source of truth; Supabase only carries changes between
-- them: an append-only log each machine pushes to and pulls from by seq, and a storage bucket for files.
-- Clients use the anon key and Ben's own session. Row level security scopes everything to auth.uid(). No service role.

-- ---------- changes ----------

create table if not exists public.changes (
  seq bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  machine_id text not null,
  entity text not null,
  entity_id text not null,
  op text not null check (op in ('upsert', 'delete')),
  data jsonb,
  ts timestamptz not null
);

-- The entities the relay takes. Set again on every run, so pasting this file again lets a relay made by an older
-- version take the newer entities (folders came later, then completions and result_read for Needs you, then
-- limit_stop for usage limits, then trigger_delivery for event automations, then remote_command for messages and Stop sent to the
-- machine running a thread). Keep it in step with SyncEntity in server/db/sync.ts.
alter table public.changes drop constraint if exists changes_entity_check;
alter table public.changes add constraint changes_entity_check
  check (entity in ('channel', 'folder', 'thread', 'event', 'artifact', 'automation_run', 'kv', 'completion', 'result_read', 'limit_stop', 'trigger_delivery', 'remote_command', 'assignment'));

create index if not exists changes_user_seq on public.changes (user_id, seq);

alter table public.changes enable row level security;

drop policy if exists "changes: read own" on public.changes;
create policy "changes: read own" on public.changes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "changes: append own" on public.changes;
create policy "changes: append own" on public.changes
  for insert to authenticated with check (user_id = auth.uid());

-- No update or delete policy: the log is append-only.

-- Pushes go through this function. It takes a per-user lock, so one user's rows commit in seq order and a pull of
-- "seq > cursor" never skips a row whose transaction committed late. Security invoker: the policies above still apply.
create or replace function public.omni_push(changes jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('omni_push:' || auth.uid()::text, 0));
  insert into public.changes (machine_id, entity, entity_id, op, data, ts)
  select c ->> 'machine_id', c ->> 'entity', c ->> 'entity_id', c ->> 'op', c -> 'data', (c ->> 'ts')::timestamptz
  from jsonb_array_elements(changes) with ordinality as x (c, n)
  order by n;
end;
$$;

revoke all on function public.omni_push(jsonb) from public, anon;
grant execute on function public.omni_push(jsonb) to authenticated;

-- Realtime, so the other Mac pulls as soon as one pushes. Realtime applies the select policy per subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'changes'
  ) then
    alter publication supabase_realtime add table public.changes;
  end if;
end;
$$;

-- ---------- storage ----------

-- Private bucket. Every path starts with the owner's user id:
--   <uid>/blobs/<sha256>                    thread files, content-addressed
--   <uid>/manifests/<thread id>.json        which blobs make up a thread's files
--   <uid>/sessions/<harness>/<session>.jsonl  Claude Code (and other harness) session files
insert into storage.buckets (id, name, public)
values ('omni', 'omni', false)
on conflict (id) do nothing;

drop policy if exists "omni: read own" on storage.objects;
create policy "omni: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'omni' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "omni: write own" on storage.objects;
create policy "omni: write own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'omni' and (storage.foldername(name))[1] = auth.uid()::text);

-- Upserts (manifests, session files) update in place.
drop policy if exists "omni: update own" on storage.objects;
create policy "omni: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'omni' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'omni' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "omni: delete own" on storage.objects;
create policy "omni: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'omni' and (storage.foldername(name))[1] = auth.uid()::text);
