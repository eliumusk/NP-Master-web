-- Job completion email opt-out + wet-lab validation feedback.

alter table jobs
  add column if not exists notify_email boolean not null default true;

create table if not exists feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  region_id   bigint references regions(id) on delete cascade,  -- null = job-level
  rating      text not null check (rating in ('accurate', 'partial', 'inaccurate')),
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- one rating per user per (job, region); region_id null maps to 0
create unique index if not exists feedback_user_job_region_uniq
  on feedback (user_id, job_id, coalesce(region_id, 0));

create index if not exists feedback_job_idx on feedback (job_id);

alter table feedback enable row level security;

create policy feedback_insert_own on feedback
  for insert with check (auth.uid() = user_id);

create policy feedback_select_own on feedback
  for select using (auth.uid() = user_id);

create policy feedback_update_own on feedback
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- admins can read all feedback (aggregate accuracy analysis)
create policy feedback_select_admin on feedback
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );
