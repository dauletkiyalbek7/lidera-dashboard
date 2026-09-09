-- Сводный код отчёта: одна группа — несколько проектов.
--
-- До сих пор код привязки жил на компании: один проект — один код — одна
-- группа. У владельца двух курсов, английского и русского, это значит две
-- группы и два разных разговора об одном и том же бизнесе. А смотрит он их
-- вместе: сколько всего потратили, сколько всего пришло, сколько продали.
--
-- Поэтому код становится отдельной сущностью: у него есть имя («Маркетинг»,
-- «Отдел продаж») и набор проектов. Старые коды компаний остаются рабочими —
-- проект по-прежнему можно привязать сам по себе.

create table if not exists public.report_codes (
  id         uuid primary key default gen_random_uuid(),
  -- Имя человеку, а не машине: в чате бот отвечает «группа привязана к
  -- отчёту "Отдел продаж"», и это должно читаться без расшифровки.
  name       text not null,
  code       text not null unique default encode(gen_random_bytes(4), 'hex'),
  created_at timestamptz not null default now()
);

comment on table public.report_codes is
  'Сводный код: один код в группе Telegram — отчёт сразу по нескольким проектам.';

create table if not exists public.report_code_companies (
  code_id    uuid not null references public.report_codes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (code_id, company_id)
);

-- Группа привязана либо к проекту, либо к сводному коду — но не к обоим:
-- иначе в чат придут два отчёта, и оба будут считаться правильными.
alter table public.report_chats
  alter column company_id drop not null,
  add column if not exists code_id uuid references public.report_codes(id) on delete cascade;

alter table public.report_chats
  drop constraint if exists report_chats_target_check;
alter table public.report_chats
  add constraint report_chats_target_check
  check ((company_id is not null) <> (code_id is not null));

alter table public.report_schedules
  alter column company_id drop not null,
  add column if not exists code_id uuid references public.report_codes(id) on delete cascade;

alter table public.report_schedules
  drop constraint if exists report_schedules_target_check;
alter table public.report_schedules
  add constraint report_schedules_target_check
  check ((company_id is not null) <> (code_id is not null));

create index if not exists report_schedules_code_idx
  on public.report_schedules (code_id, status);

-- -----------------------------------------------------------------------------
-- Кому сводный код доступен.
--
-- Сводный отчёт складывает деньги нескольких проектов в одну строку, поэтому
-- владеть им может только тот, у кого есть вход в КАЖДЫЙ из них. Директору
-- одного проекта такой код не показывается и не создаётся: иначе через отчёт
-- утекли бы чужие цифры в обход всех остальных политик.
-- -----------------------------------------------------------------------------
create or replace function private.report_code_allowed(cid uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    private.is_super_admin()
    or (
      exists (select 1 from public.report_code_companies rc where rc.code_id = cid)
      and not exists (
        select 1
          from public.report_code_companies rc
         where rc.code_id = cid
           and rc.company_id not in (
             select p.company_id
               from public.profiles p
              where p.user_id = (select auth.uid())
                and p.status = 'active'
                and p.company_id is not null
           )
      )
    );
$$;

alter table public.report_codes enable row level security;
alter table public.report_code_companies enable row level security;

drop policy if exists report_codes_select on public.report_codes;
create policy report_codes_select on public.report_codes
  for select to authenticated
  using (private.report_code_allowed(id));

drop policy if exists report_codes_write on public.report_codes;
create policy report_codes_write on public.report_codes
  for all to authenticated
  using (private.report_code_allowed(id) and private.can_write())
  with check (private.can_write());

-- Строка связи создаётся сразу после кода, когда проектов у него ещё нет, —
-- поэтому право проверяем по самому проекту: свой можно добавить, чужой нет.
drop policy if exists report_code_companies_select on public.report_code_companies;
create policy report_code_companies_select on public.report_code_companies
  for select to authenticated
  using (private.report_code_allowed(code_id));

drop policy if exists report_code_companies_write on public.report_code_companies;
create policy report_code_companies_write on public.report_code_companies
  for all to authenticated
  using (
    private.is_super_admin()
    or (
      private.can_write()
      and company_id in (
        select p.company_id
          from public.profiles p
         where p.user_id = (select auth.uid())
           and p.status = 'active'
           and p.company_id is not null
      )
    )
  )
  with check (
    private.is_super_admin()
    or (
      private.can_write()
      and company_id in (
        select p.company_id
          from public.profiles p
         where p.user_id = (select auth.uid())
           and p.status = 'active'
           and p.company_id is not null
      )
    )
  );

-- Группы и расписания сводного кода: старые политики спрашивают company_id и
-- на этих строках молчат, поэтому им нужна своя.
drop policy if exists report_chats_code_select on public.report_chats;
create policy report_chats_code_select on public.report_chats
  for select to authenticated
  using (code_id is not null and private.report_code_allowed(code_id));

drop policy if exists report_chats_code_write on public.report_chats;
create policy report_chats_code_write on public.report_chats
  for all to authenticated
  using (code_id is not null and private.report_code_allowed(code_id) and private.can_write())
  with check (code_id is not null and private.report_code_allowed(code_id) and private.can_write());

drop policy if exists report_schedules_code_select on public.report_schedules;
create policy report_schedules_code_select on public.report_schedules
  for select to authenticated
  using (code_id is not null and private.report_code_allowed(code_id));

drop policy if exists report_schedules_code_write on public.report_schedules;
create policy report_schedules_code_write on public.report_schedules
  for all to authenticated
  using (code_id is not null and private.report_code_allowed(code_id) and private.can_write())
  with check (code_id is not null and private.report_code_allowed(code_id) and private.can_write());

-- Отметка об отправке читается через расписание — у сводного расписания
-- company_id пустой, и старая политика его не находит.
drop policy if exists report_deliveries_code_select on public.report_deliveries;
create policy report_deliveries_code_select on public.report_deliveries
  for select to authenticated
  using (
    exists (
      select 1
        from public.report_schedules s
       where s.id = report_deliveries.schedule_id
         and s.code_id is not null
         and private.report_code_allowed(s.code_id)
    )
  );
