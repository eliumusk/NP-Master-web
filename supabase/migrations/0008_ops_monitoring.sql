create table public.ops_snapshots (
  source      text primary key,
  metrics     jsonb not null,
  updated_at  timestamptz not null default now()
);

create table public.ops_feishu_events (
  event_id    text primary key,
  received_at timestamptz not null default now()
);

alter table public.ops_snapshots enable row level security;
alter table public.ops_feishu_events enable row level security;
