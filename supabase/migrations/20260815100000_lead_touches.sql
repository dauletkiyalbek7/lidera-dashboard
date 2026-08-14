-- =============================================================================
-- Lidera Final — касания вместо отъёма лида
--
-- Прежнее правило забирало необработанный лид у менеджера и отдавало другому.
-- На практике это вредно: номер уже звонил одному человеку, второй звонок с
-- другого номера выглядит как спам, а менеджер теряет мотивацию дожимать —
-- «всё равно отберут». Поэтому лид остаётся у того, кому достался, до конца.
--
-- Вместо отъёма — касания. Не дозвонился — менеджер сам говорит, когда
-- перезвонит; бот в это время напоминает. Если обещание просрочено, его
-- видит РОП. После нескольких безрезультатных касаний бот предлагает закрыть
-- лид, но решает всё равно человек.
--
-- sla_minutes меняет смысл: это не срок отъёма, а срок первого напоминания.
-- =============================================================================

comment on column public.companies.sla_minutes is
  'Через сколько минут бот напомнит про нетронутый лид. Лид не отбирается.';

alter table public.companies
  add column max_touches int not null default 5 check (max_touches between 1 and 20);

comment on column public.companies.max_touches is
  'После скольких безрезультатных касаний бот предлагает закрыть лид.';

-- Ближайшее обещание и счётчик попыток лежат на самом лиде: и раздатчику, и
-- спискам нужен ответ «пора ли трогать» одним чтением, без обхода журнала.
alter table public.leads
  add column next_touch_at timestamptz,
  add column last_touch_at timestamptz,
  add column touch_count   int not null default 0;

create table public.lead_touches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  lead_id     uuid not null references public.leads (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete set null,
  -- promise — менеджер обещал перезвонить в назначенное время;
  -- nudge    — бот сам напомнил про нетронутый лид;
  -- note     — отметка о состоявшейся попытке.
  kind        text not null default 'promise'
                check (kind in ('promise', 'nudge', 'note')),
  -- Когда напомнить. У выполненного касания стоит done_at.
  remind_at   timestamptz,
  notified_at timestamptz,
  done_at     timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);

create index lead_touches_lead_idx on public.lead_touches (lead_id, created_at desc);
-- Запрос планировщика: чьё время пришло и кому ещё не отправляли.
create index lead_touches_due_idx on public.lead_touches (remind_at)
  where notified_at is null and done_at is null;
create index lead_touches_employee_idx
  on public.lead_touches (employee_id, remind_at) where done_at is null;

-- Просроченные обещания в кабинете РОПа ищутся именно так.
create index leads_next_touch_idx on public.leads (company_id, next_touch_at)
  where next_touch_at is not null;

alter table public.lead_touches enable row level security;

create policy lead_touches_select on public.lead_touches
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy lead_touches_insert on public.lead_touches
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy lead_touches_update on public.lead_touches
  for update to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );
