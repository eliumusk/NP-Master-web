-- v0.2 changes:
--   1. Allow anonymous (un-authenticated) job submission. user_id becomes
--      nullable; an additional `client_id` column tracks anonymous users
--      via a browser-generated UUID stored client-side.
--   2. Raise the FASTA size cap from 10 MB to 50 MB (anon: 25 MB enforced
--      in app code; logged-in users get up to 50 MB).
--   3. Update the rate-limit trigger to apply per-(user_id OR client_id).
--
-- All anon writes go through the service-role key on the API route, so RLS
-- stays restrictive. Anon reads happen on the API route too (no anon role
-- access — simpler than maintaining a client_id-aware policy).

alter table jobs alter column user_id drop not null;
alter table jobs add column if not exists client_id text;

-- Loosen the bytes check (we'll enforce per-tier in app code).
alter table jobs drop constraint if exists jobs_fasta_bytes_check;
alter table jobs add constraint jobs_fasta_bytes_check
  check (fasta_bytes > 0 and fasta_bytes <= 52428800); -- 50 MB

-- Either user_id or client_id must be set (not both null).
alter table jobs add constraint jobs_owner_present
  check (user_id is not null or client_id is not null);

create index if not exists jobs_client_recent_idx
  on jobs (client_id, created_at desc) where client_id is not null;

-- Replace rate limit trigger function: count active jobs per owner key,
-- where owner key = user_id ?? client_id.
create or replace function public.enforce_user_job_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count int;
  is_admin_user boolean := false;
begin
  if new.user_id is not null then
    select is_admin into is_admin_user from public.profiles where id = new.user_id;
    if coalesce(is_admin_user, false) then
      return new;
    end if;
    select count(*) into active_count
      from public.jobs
     where user_id = new.user_id
       and status in ('queued', 'running');
  else
    -- anon: rate limit by client_id; cap is lower (3 per day handled in app code,
    -- here we just cap concurrent active queue depth)
    select count(*) into active_count
      from public.jobs
     where client_id = new.client_id
       and status in ('queued', 'running');
  end if;

  if active_count >= 3 then
    raise exception 'rate limit: at most 3 active jobs (queued or running) per user/client';
  end if;
  return new;
end;
$$;

-- The user-update guard trigger should be permissive for anon rows since
-- those are only written via service role. Update the guard to skip when
-- the row has client_id (no auth.uid() concept applies).
create or replace function public.guard_job_user_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin_user boolean;
begin
  if current_setting('request.jwt.claim.role', true) is null
     or current_setting('request.jwt.claim.role', true) <> 'authenticated' then
    return new;  -- service_role bypass
  end if;

  if old.user_id is null then
    -- anon-owned row; only service_role should be touching it.
    raise exception 'anon-owned job rows can only be modified by the service role';
  end if;

  select is_admin into is_admin_user from public.profiles where id = auth.uid();
  if is_admin_user then
    return new;
  end if;

  if old.status = 'queued' and new.status = 'canceled'
     and new.user_id = old.user_id
     and new.fasta_path = old.fasta_path
     and new.fasta_sha256 = old.fasta_sha256 then
    return new;
  end if;

  raise exception 'jobs: only cancellation of queued jobs is permitted via user role';
end;
$$;
