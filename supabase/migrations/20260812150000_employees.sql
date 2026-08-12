-- =============================================================================
-- Lidera Final — сотрудники компании и ответственный за лида
--
-- Сотрудник НЕ получает вход в кабинет: платформу видит только директор.
-- Работать сотрудник будет через Telegram-бот, поэтому вместо учётной записи
-- у него telegram_user_id — привязка появится на следующем этапе, пока поле
-- пустое, и карточку можно завести заранее.
--
-- Роли:
--   rop         — руководитель отдела продаж;
--   manager     — обрабатывает лиды; в воронке с пробными записывает на пробное;
--   salesperson — проводит пробное и закрывает продажу (только воронка trial).
--
-- Увольнение мягкое: status = 'fired' + дата. История лидов и продаж
-- сотрудника остаётся — иначе отчёты за прошлые периоды развалятся.
-- =============================================================================

create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  full_name        text not null,
  role             text not null check (role in ('rop', 'manager', 'salesperson')),
  phone            text,
  -- Заполняется ботом при переходе по одноразовой ссылке-приглашению.
  telegram_user_id bigint unique,
  telegram_username text,
  status           text not null default 'active' check (status in ('active', 'fired')),
  hired_at         timestamptz not null default now(),
  fired_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index employees_company_status_idx on public.employees (company_id, status);
create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

-- Ответственный за лида. on delete set null не нужен: сотрудников не удаляем,
-- но если компанию сотрут каскадом, лид уйдёт вместе с ней.
alter table public.leads
  add column assigned_to uuid references public.employees (id) on delete set null,
  add column assigned_at timestamptz;

create index leads_assigned_to_idx on public.leads (company_id, assigned_to);

-- -----------------------------------------------------------------------------
-- RLS — те же правила, что у остальных таблиц с company_id
-- -----------------------------------------------------------------------------
alter table public.employees enable row level security;

create policy employees_select on public.employees
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy employees_insert on public.employees
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy employees_update on public.employees
  for update to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy employees_delete on public.employees
  for delete to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );
