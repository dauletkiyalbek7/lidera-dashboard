-- =============================================================================
-- Lidera Final — режимы смены, геолокация офиса и посещаемость
--
-- Компании работают по-разному, поэтому режим смены выбирается, а не зашит:
--   always — смены нет вовсе, менеджер получает лиды всегда;
--   shift  — лиды идут только тому, кто нажал «Я на смене»;
--   geo    — смену можно открыть только рядом с офисом.
--
-- Радиус не меньше 50 метров: точность GPS на телефоне в городе редко бывает
-- лучше, и при 20–30 метрах сотрудник, стоящий в офисе, получал бы отказ.
--
-- Статусы посещаемости у каждой компании свои: где-то хватает трёх, где-то
-- нужны больничный и отпуск. Набор берётся из общего справочника, поэтому
-- отчёты остаются сравнимыми между компаниями.
-- =============================================================================

alter table public.companies
  add column shift_mode text not null default 'shift'
    check (shift_mode in ('always', 'shift', 'geo')),
  add column office_lat numeric(9, 6),
  add column office_lng numeric(9, 6),
  add column office_radius_m int not null default 100
    check (office_radius_m between 50 and 5000),
  add column office_label text,
  add column timezone text not null default 'Asia/Almaty',
  add column work_start_time time not null default '09:00',
  add column late_grace_minutes int not null default 10
    check (late_grace_minutes between 0 and 120),
  add column attendance_statuses text[] not null
    default array['on_shift', 'late', 'absent'];

-- Где и когда открыли смену — чтобы спор «я был на месте» решался фактом.
alter table public.shifts
  add column start_lat      numeric(9, 6),
  add column start_lng      numeric(9, 6),
  add column start_distance_m int,
  add column late           boolean not null default false;

-- Один день — одна отметка на сотрудника.
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  date        date not null,
  status      text not null check (status in (
                'on_shift', 'late', 'absent', 'sick', 'vacation', 'day_off', 'remote'
              )),
  note        text,
  -- auto — поставила система при открытии смены, manual — директор руками.
  source      text not null default 'manual' check (source in ('auto', 'manual')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, date)
);

create index attendance_company_date_idx on public.attendance (company_id, date desc);

create trigger attendance_set_updated_at
  before update on public.attendance
  for each row execute function public.set_updated_at();

alter table public.attendance enable row level security;

create policy attendance_select on public.attendance
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy attendance_update on public.attendance
  for update to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy attendance_delete on public.attendance
  for delete to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );
