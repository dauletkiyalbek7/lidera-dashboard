-- =============================================================================
-- Lidera Final — приглашения сотрудников в Telegram и рабочие смены
--
-- Сотрудник не заводит пароль: директор создаёт приглашение, платформа отдаёт
-- ссылку t.me/<бот>?start=<token>. Первый переход по ней привязывает Telegram
-- к карточке сотрудника — токен одноразовый и с сроком годности, чтобы
-- пересланная ссылка не открыла доступ постороннему.
--
-- Смена — выключатель для авто-раздачи: лиды получают только те, кто на смене.
-- Открытая смена — строка с ended_at is null; частичный уникальный индекс
-- физически запрещает две открытые смены у одного человека.
-- =============================================================================

create table public.employee_invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  token       text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index employee_invites_employee_idx on public.employee_invites (employee_id);

create table public.shifts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  -- Откуда открыта смена: пока только бот, позже возможен ручной ввод директором.
  source      text not null default 'telegram' check (source in ('telegram', 'manual')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index shifts_one_open_per_employee_idx
  on public.shifts (employee_id) where ended_at is null;
create index shifts_company_started_idx on public.shifts (company_id, started_at desc);

create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — те же правила, что у остальных таблиц с company_id
-- -----------------------------------------------------------------------------
do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array['employee_invites', 'shifts']
  loop
    execute format('alter table public.%I enable row level security', tenant_table);

    execute format($f$
      create policy %1$I_select on public.%1$I
        for select to authenticated
        using (private.is_super_admin() or company_id = private.current_company_id())
    $f$, tenant_table);

    execute format($f$
      create policy %1$I_insert on public.%1$I
        for insert to authenticated
        with check (
          private.is_super_admin()
          or (company_id = private.current_company_id() and private.can_write())
        )
    $f$, tenant_table);

    execute format($f$
      create policy %1$I_update on public.%1$I
        for update to authenticated
        using (
          private.is_super_admin()
          or (company_id = private.current_company_id() and private.can_write())
        )
        with check (
          private.is_super_admin()
          or (company_id = private.current_company_id() and private.can_write())
        )
    $f$, tenant_table);

    execute format($f$
      create policy %1$I_delete on public.%1$I
        for delete to authenticated
        using (
          private.is_super_admin()
          or (company_id = private.current_company_id() and private.can_write())
        )
    $f$, tenant_table);
  end loop;
end;
$$;
