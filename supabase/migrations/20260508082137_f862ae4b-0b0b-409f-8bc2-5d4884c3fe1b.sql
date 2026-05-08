-- 1. enum ролей
do $$ begin
  create type public.app_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

-- 2. таблица ролей
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

-- 3. функция проверки роли (security definer, без рекурсии RLS)
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

-- 4. RLS на user_roles: пользователь видит свои роли, админ — все
drop policy if exists ur_select_self on public.user_roles;
create policy ur_select_self on public.user_roles
  for select using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

drop policy if exists ur_admin_all on public.user_roles;
create policy ur_admin_all on public.user_roles
  for all using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 5. назначить админа (существующий единственный пользователь)
insert into public.user_roles (user_id, role)
select id, 'admin'::public.app_role from auth.users
where email = 'ivankraev91@gmail.com'
on conflict (user_id, role) do nothing;

-- 6. закрыть system_alerts: видят только админы
alter table public.system_alerts enable row level security;
drop policy if exists sa_admin_select on public.system_alerts;
create policy sa_admin_select on public.system_alerts
  for select using (public.has_role(auth.uid(), 'admin'));