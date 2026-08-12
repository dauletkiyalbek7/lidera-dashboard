-- =============================================================================
-- Lidera Final — 01. Ядро: компании, профили, подписки
-- Multi-tenant SaaS: любая строка данных клиента принадлежит ровно одной компании
-- через company_id. Изоляция обеспечивается RLS (см. миграцию 04_rls).
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Утилита: автоматическое обновление updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- companies — арендатор (tenant). Корень всей изоляции данных.
-- -----------------------------------------------------------------------------
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  director_name text,
  phone         text,
  email         text,
  status        text not null default 'active'
                  check (status in ('active', 'inactive', 'trial')),
  -- Демо-данные строго отделены от production: весь демо-контент живёт
  -- внутри компании с is_demo = true.
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index companies_status_idx on public.companies (status);
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- profiles — расширение auth.users; связывает пользователя с компанией и ролью.
-- SUPER_ADMIN — владелец платформы Lidera, company_id = null.
-- DIRECTOR    — директор подключённой компании.
-- MANAGER / EMPLOYEE зарезервированы под будущий модуль сотрудников.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  role       text not null default 'DIRECTOR'
               check (role in ('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'EMPLOYEE')),
  name       text not null default '',
  email      text,
  phone      text,
  status     text not null default 'active'
               check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- У платформенного администратора компании нет; у всех остальных — обязательна.
  constraint profiles_company_required
    check (role = 'SUPER_ADMIN' or company_id is not null)
);

create index profiles_company_id_idx on public.profiles (company_id);
create index profiles_role_idx on public.profiles (role);
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- subscriptions — тариф компании. Биллинг подключается позже, структура готова.
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  plan       text not null default 'trial'
               check (plan in ('trial', 'start', 'pro', 'enterprise')),
  status     text not null default 'active'
               check (status in ('active', 'past_due', 'canceled', 'expired')),
  start_date date not null default current_date,
  end_date   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_company_id_idx on public.subscriptions (company_id);
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
