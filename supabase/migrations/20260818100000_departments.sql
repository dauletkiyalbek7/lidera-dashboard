-- =============================================================================
-- Lidera Final — отделы продаж внутри компании
--
-- До сих пор компания была неделима: один поток лидов, одна касса, один
-- коллектив. У Дарына иначе — внутри одного проекта работают два отдела
-- продаж. Кабинет у них общий, а кампании, бюджеты и лиды разные, и сравнить
-- отделы между собой можно только если каждая цифра знает свой отдел.
--
-- Отдел не удаляем, а архивируем: расход и продажи прошлых месяцев должны
-- остаться привязанными, иначе отчёт за прошлый период развалится.
--
-- Компаниям с одним отделом ничего заводить не нужно: пустой department_id
-- означает «весь проект целиком», и все существующие экраны работают как
-- работали.
-- =============================================================================

create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name       text not null,
  status     text not null default 'active'
               check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create index departments_company_status_idx
  on public.departments (company_id, status);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Метки отдела.
--
-- Везде on delete set null: отдел архивируют, а не стирают, но если компанию
-- удалят каскадом — строки уйдут вместе с ней, а не повиснут на пустой ссылке.
--
--   campaigns — по ним делится бюджет: расход отдела = расход его кампаний;
--   leads     — из какого потока пришла заявка;
--   employees — кто в каком отделе работает.
-- -----------------------------------------------------------------------------
alter table public.campaigns
  add column department_id uuid references public.departments (id) on delete set null;

alter table public.leads
  add column department_id uuid references public.departments (id) on delete set null;

alter table public.employees
  add column department_id uuid references public.departments (id) on delete set null;

create index campaigns_department_idx on public.campaigns (company_id, department_id);
create index leads_department_idx     on public.leads (company_id, department_id);
create index employees_department_idx on public.employees (company_id, department_id);

comment on column public.campaigns.department_id is
  'Отдел, которому принадлежит бюджет кампании. Пусто — общий бюджет проекта.';
comment on column public.leads.department_id is
  'Отдел, в поток которого попала заявка. Пусто — проект без разделения.';

-- -----------------------------------------------------------------------------
-- RLS — те же правила, что у остальных таблиц с company_id
-- -----------------------------------------------------------------------------
alter table public.departments enable row level security;

create policy departments_select on public.departments
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy departments_insert on public.departments
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy departments_update on public.departments
  for update to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy departments_delete on public.departments
  for delete to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );
