-- Apply after schema.sql. Existing clients can still write during the rollout.
begin;

alter table public.user_data
  add column if not exists revision uuid not null default gen_random_uuid();

-- Both the new function and legacy writes advance the opaque revision.
create or replace function public.refresh_user_snapshot_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := pg_catalog.gen_random_uuid();
  return new;
end;
$$;

drop trigger if exists user_snapshot_revision on public.user_data;
create trigger user_snapshot_revision
  before insert or update on public.user_data
  for each row execute function public.refresh_user_snapshot_revision();

create or replace function public.commit_user_snapshot(expected_owner uuid, expected_revision uuid, snapshot jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  committed uuid;
begin
  if actor is null or actor is distinct from expected_owner then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if jsonb_typeof(snapshot) is distinct from 'object'
    or snapshot->'version' is distinct from '2'::jsonb
    or jsonb_typeof(snapshot->'goals') is distinct from 'array'
    or jsonb_typeof(snapshot->'events') is distinct from 'array'
    or jsonb_typeof(snapshot->'weekPresets') is distinct from 'array'
    or jsonb_typeof(snapshot->'weekEvents') is distinct from 'array'
  then
    raise exception 'invalid snapshot' using errcode = '22023';
  end if;

  if expected_revision is null then
    insert into public.user_data (user_id, data) values (actor, snapshot)
      on conflict (user_id) do nothing returning revision into committed;
  else
    update public.user_data
      set data = snapshot
      where user_id = actor and revision = expected_revision
      returning revision into committed;
  end if;
  return committed;
end;
$$;

revoke all on function public.commit_user_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.commit_user_snapshot(uuid, uuid, jsonb) to authenticated;

commit;
