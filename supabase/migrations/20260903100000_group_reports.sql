-- Отчёты в группу Telegram по расписанию.
--
-- Руководитель не заходит в кабинет каждый час: ему нужно, чтобы цифры сами
-- приходили туда, где команда и так переписывается. Бот уже живёт в
-- платформе, планировщик уже ходит раз в минуту — не хватало только адреса
-- группы и времени отправки.

-- Код привязки: короткое слово, которое директор отправляет в группу вместе с
-- командой. Без него бот не знает, к какому проекту относится чат, а групп у
-- владельца много и все они выглядят для бота одинаково.
alter table public.companies
  add column if not exists report_code text;

update public.companies
   set report_code = encode(gen_random_bytes(4), 'hex')
 where report_code is null;

alter table public.companies
  alter column report_code set default encode(gen_random_bytes(4), 'hex');

create unique index if not exists companies_report_code_idx
  on public.companies (report_code);

comment on column public.companies.report_code is
  'Код для команды /отчёт в группе Telegram: привязывает чат к этому проекту.';

-- Группы, куда платформа шлёт отчёты.
create table if not exists public.report_chats (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Одна группа — один проект: иначе в чате смешаются цифры разных бизнесов.
  chat_id    bigint not null unique,
  title      text,
  -- Кто привязал: в группе команду может отправить кто угодно, и разбираться
  -- потом проще, когда видно имя.
  linked_by  text,
  created_at timestamptz not null default now()
);

-- Расписание: строка на каждое время отправки.
create table if not exists public.report_schedules (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  chat_id    uuid not null references public.report_chats(id) on delete cascade,
  -- Время местное для проекта: у компании свой часовой пояс.
  send_at    time not null,
  period     text not null default 'today'
               check (period in ('today', 'yesterday', 'week', 'month')),
  -- Какие блоки показывать. Набор растёт, поэтому массивом, а не колонками.
  sections   text[] not null default '{ads,breakdown}',
  status     text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now()
);

create index if not exists report_schedules_company_idx
  on public.report_schedules (company_id, status);

-- Отметка об отправке.
--
-- Планировщик ходит раз в минуту, а время отправки наступает один раз: без
-- отметки группа получала бы один и тот же отчёт каждую минуту.
create table if not exists public.report_deliveries (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  date        date not null,
  sent_at     timestamptz not null default now()
);

create unique index if not exists report_deliveries_once_idx
  on public.report_deliveries (schedule_id, date);

alter table public.report_chats enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_deliveries enable row level security;

create policy report_chats_select on public.report_chats
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy report_chats_write on public.report_chats
  for all to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy report_schedules_select on public.report_schedules
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy report_schedules_write on public.report_schedules
  for all to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

-- Пишет только планировщик сервисным ключом. Читать может компания — чтобы в
-- настройках было видно, ушёл отчёт или нет.
create policy report_deliveries_select on public.report_deliveries
  for select to authenticated
  using (
    private.is_super_admin()
    or exists (
      select 1
        from public.report_schedules s
       where s.id = report_deliveries.schedule_id
         and s.company_id = private.current_company_id()
    )
  );
