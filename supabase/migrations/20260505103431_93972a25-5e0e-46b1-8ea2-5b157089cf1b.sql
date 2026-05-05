
-- organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  city text,
  yandex_id text not null,
  address text,
  lat double precision,
  lon double precision,
  created_at timestamptz not null default now()
);
create index on public.organizations(user_id);
alter table public.organizations enable row level security;
create policy "org_select_own" on public.organizations for select using (auth.uid() = user_id);
create policy "org_insert_own" on public.organizations for insert with check (auth.uid() = user_id);
create policy "org_update_own" on public.organizations for update using (auth.uid() = user_id);
create policy "org_delete_own" on public.organizations for delete using (auth.uid() = user_id);

-- keywords
create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  created_at timestamptz not null default now()
);
create index on public.keywords(org_id);
alter table public.keywords enable row level security;
create policy "kw_select_own" on public.keywords for select using (auth.uid() = user_id);
create policy "kw_insert_own" on public.keywords for insert with check (auth.uid() = user_id);
create policy "kw_update_own" on public.keywords for update using (auth.uid() = user_id);
create policy "kw_delete_own" on public.keywords for delete using (auth.uid() = user_id);

-- geopoints
create table public.geopoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  lat double precision not null,
  lon double precision not null,
  created_at timestamptz not null default now()
);
create index on public.geopoints(org_id);
alter table public.geopoints enable row level security;
create policy "gp_select_own" on public.geopoints for select using (auth.uid() = user_id);
create policy "gp_insert_own" on public.geopoints for insert with check (auth.uid() = user_id);
create policy "gp_update_own" on public.geopoints for update using (auth.uid() = user_id);
create policy "gp_delete_own" on public.geopoints for delete using (auth.uid() = user_id);

-- checks
create table public.checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  geopoint_id uuid not null references public.geopoints(id) on delete cascade,
  position integer,
  total_results integer,
  checked_at timestamptz not null default now(),
  raw_response jsonb
);
create index on public.checks(user_id, checked_at desc);
create index on public.checks(org_id, checked_at desc);
alter table public.checks enable row level security;
create policy "ch_select_own" on public.checks for select using (auth.uid() = user_id);
create policy "ch_insert_own" on public.checks for insert with check (auth.uid() = user_id);
create policy "ch_delete_own" on public.checks for delete using (auth.uid() = user_id);
