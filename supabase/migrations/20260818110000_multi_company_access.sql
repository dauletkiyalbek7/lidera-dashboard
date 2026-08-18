-- =============================================================================
-- Lidera Final — несколько проектов на один вход
--
-- До сих пор вход и проект были одним и тем же: у пользователя ровно один
-- профиль, у профиля одна компания. Для одного бизнеса этого хватало.
--
-- У Дарына бизнес один, а проектов два — NIS и UBT, с разными кабинетами,
-- бюджетами и отделами. Держать их одной компанией нельзя: тогда бюджеты и
-- лиды перемешаются. Заводить два логина — значит заставлять человека
-- выходить и заходить заново, чтобы посмотреть свой же второй проект.
--
-- Поэтому связь «пользователь → компания» становится множественной, а какой
-- из проектов человек смотрит прямо сейчас, помнит active_company.
--
-- Правила изоляции при этом не меняются ни в одной таблице: все 90 политик
-- спрашивают private.current_company_id(), и достаточно научить отвечать её
-- одну. Важно только, чтобы все служебные функции выбирали ОДИН И ТОТ ЖЕ
-- профиль — иначе роль возьмётся от одного проекта, а данные от другого.
-- Отсюда общий корень: private.current_profile_id().
-- =============================================================================

-- Один пользователь — по профилю на компанию.
alter table public.profiles
  drop constraint profiles_user_id_key;

create unique index profiles_user_company_idx
  on public.profiles (user_id, company_id);

-- Пользователь без компании (SUPER_ADMIN) остаётся ровно один раз: в
-- предыдущем индексе NULL не сравнивается сам с собой и дубли бы прошли.
create unique index profiles_user_without_company_idx
  on public.profiles (user_id)
  where company_id is null;

-- -----------------------------------------------------------------------------
-- Какой проект человек смотрит сейчас.
--
-- Выбор живёт в базе, а не в куке: правила изоляции выполняются внутри
-- Postgres и до браузера не достают.
-- -----------------------------------------------------------------------------
create table public.active_company (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.active_company enable row level security;

create policy active_company_select on public.active_company
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Переключиться можно только туда, где у человека есть действующий профиль.
-- Проверка стоит в базе, а не только в коде: подставить чужой company_id в
-- запрос куда проще, чем обойти политику.
create policy active_company_write on public.active_company
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
       where p.user_id = (select auth.uid())
         and p.company_id = active_company.company_id
         and p.status = 'active'
    )
  );

-- -----------------------------------------------------------------------------
-- Общий корень: профиль, от лица которого человек работает прямо сейчас.
--
-- Выбранный проект идёт первым, но только если профиль в нём действующий.
-- Не выбран или выбран чужой — берём самый старый профиль, чтобы ответ был
-- один и тот же при каждом вызове.
-- -----------------------------------------------------------------------------
create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select p.id
    from public.profiles p
   where p.user_id = (select auth.uid())
     and p.status = 'active'
   order by (
     p.company_id is not distinct from (
       select a.company_id from public.active_company a
        where a.user_id = (select auth.uid())
     )
   ) desc, p.created_at, p.id
   limit 1;
$$;

create or replace function private.current_company_id()
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select p.company_id from public.profiles p where p.id = private.current_profile_id();
$$;

create or replace function private.auth_role()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select p.role from public.profiles p where p.id = private.current_profile_id();
$$;

-- -----------------------------------------------------------------------------
-- Карточка сотрудника тоже привязана к профилю, а значит к выбранному
-- проекту: в одном человек может быть менеджером, в другом никем.
-- -----------------------------------------------------------------------------
create or replace function private.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select e.id
    from public.employees e
   where e.profile_id = private.current_profile_id()
     and e.status = 'active'
   limit 1;
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.employees e
     where e.profile_id = private.current_profile_id()
       and e.status = 'active'
       and e.role in ('manager', 'salesperson')
  );
$$;

create or replace function private.sees_whole_company()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select not private.is_staff();
$$;

create or replace function private.can_send_capi()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    private.is_super_admin()
    or coalesce(private.auth_role() = 'DIRECTOR', false)
    or exists (
      select 1 from public.employees e
       where e.profile_id = private.current_profile_id()
         and e.status = 'active'
         and e.role = 'targetolog'
    );
$$;
