
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- scrape_jobs
create table public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  org_id uuid not null,
  keyword_id uuid not null,
  geopoint_id uuid not null,
  status text not null default 'pending', -- pending | running | done | failed
  attempts int not null default 0,
  error text,
  result_check_id uuid,
  next_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index scrape_jobs_status_next_idx on public.scrape_jobs (status, next_run_at);
create index scrape_jobs_user_idx on public.scrape_jobs (user_id, created_at desc);

alter table public.scrape_jobs enable row level security;

create policy "sj_select_own" on public.scrape_jobs for select using (auth.uid() = user_id);
create policy "sj_insert_own" on public.scrape_jobs for insert with check (auth.uid() = user_id);

-- scrape_sessions: proxy pool + cookies
create table public.scrape_sessions (
  id uuid primary key default gen_random_uuid(),
  proxy text not null unique,
  cookies jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  banned_until timestamptz,
  pool text not null default 'check', -- 'check' | 'search'
  created_at timestamptz not null default now()
);
alter table public.scrape_sessions enable row level security;
-- no policies = service role only

-- proxy_health
create table public.proxy_health (
  proxy text primary key,
  success_count int not null default 0,
  fail_count int not null default 0,
  last_success_at timestamptz,
  last_fail_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.proxy_health enable row level security;

-- system_alerts
create table public.system_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  message text not null,
  created_at timestamptz not null default now()
);
alter table public.system_alerts enable row level security;
