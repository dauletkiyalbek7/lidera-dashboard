-- Рабочее место в боте: продажа без урока и отчёт за день.

-- В прямой воронке продажу закрывает тот же менеджер, который принял лид, и
-- урока в ней нет вовсе. Поэтому сумму бот ждёт по лиду, а не по уроку:
-- прежнее поле ссылается на trials и для товарного бизнеса не годится.
alter table public.employees
  add column if not exists awaiting_sale_lead uuid
    references public.leads(id) on delete set null;

comment on column public.employees.awaiting_sale_lead is
  'Лид, по которому бот ждёт сумму продажи (воронка без урока).';

-- Отметка о том, что отчёт за день уже ушёл.
--
-- Планировщик ходит раз в минуту, а конец рабочего дня наступает один раз:
-- без этой таблицы сотрудник получал бы один и тот же отчёт каждую минуту до
-- полуночи.
create table if not exists public.day_reports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- Пусто у сводки для руководителя: она одна на компанию.
  employee_id uuid references public.employees(id) on delete cascade,
  date        date not null,
  kind        text not null check (kind in ('employee', 'summary')),
  sent_at     timestamptz not null default now()
);

-- Уникальность с coalesce: NULL в обычном уникальном индексе не повторяется,
-- и сводка ушла бы столько раз, сколько минут осталось до полуночи.
create unique index if not exists day_reports_once_idx
  on public.day_reports (
    company_id,
    date,
    kind,
    coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.day_reports enable row level security;

-- Пишет только планировщик сервисным ключом, в обход RLS. Читать может
-- компания — чтобы в кабинете было видно, ушёл отчёт или нет.
create policy day_reports_select on public.day_reports
  for select using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.sees_whole_company())
  );
