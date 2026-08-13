-- =============================================================================
-- Lidera Final — авто-раздача лидов
--
-- Правила раздачи держатся на трёх числах, и все три настраиваются компанией,
-- а не зашиты в код:
--   auto_assign     — включена ли раздача вообще;
--   max_open_leads  — сколько активных лидов может висеть на менеджере;
--   sla_minutes     — сколько минут даётся на первое касание, после чего лид
--                     возвращается в очередь и уходит другому.
--
-- Журнал назначений нужен не для красоты: без него нельзя ни разобрать спор
-- «мне лид не приходил», ни считать честную очередь (кто дольше не получал).
-- =============================================================================

alter table public.companies
  add column auto_assign     boolean not null default true,
  add column max_open_leads  int     not null default 15 check (max_open_leads between 1 and 200),
  add column sla_minutes     int     not null default 10 check (sla_minutes between 1 and 1440);

create table public.lead_assignments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  lead_id     uuid not null references public.leads (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  -- Почему лид оказался у сотрудника или ушёл от него.
  reason      text not null default 'auto'
                check (reason in ('auto', 'manual', 'sla', 'fired', 'shift_end')),
  created_at  timestamptz not null default now()
);

create index lead_assignments_lead_idx on public.lead_assignments (lead_id, assigned_at desc);
create index lead_assignments_employee_idx
  on public.lead_assignments (employee_id, assigned_at desc);

-- Очередь и просрочка ищутся именно этими двумя запросами.
create index leads_unassigned_idx on public.leads (company_id, created_at)
  where assigned_to is null;
create index leads_untouched_idx on public.leads (company_id, assigned_at)
  where status = 'new' and assigned_to is not null;

alter table public.lead_assignments enable row level security;

create policy lead_assignments_select on public.lead_assignments
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy lead_assignments_insert on public.lead_assignments
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy lead_assignments_update on public.lead_assignments
  for update to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );
