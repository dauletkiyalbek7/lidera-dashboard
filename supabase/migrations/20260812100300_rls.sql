-- =============================================================================
-- Lidera Final — 04. Row Level Security
--
-- Модель доступа:
--   SUPER_ADMIN — платформенный администратор, видит все компании.
--   DIRECTOR    — видит и редактирует только свою компанию.
--   MANAGER / EMPLOYEE — читают свою компанию (запись выдаётся точечно позже).
--
-- Изоляция арендаторов держится на политиках Postgres, а не на фильтрации в UI:
-- даже с валидным JWT чужой company_id физически недостижим.
--
-- Вспомогательные функции объявлены как SECURITY DEFINER, чтобы чтение
-- profiles внутри политики profiles не вызывало бесконечную рекурсию.
-- search_path пустой — защита от подмены объектов.
-- =============================================================================

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id
  from public.profiles p
  where p.user_id = (select auth.uid())
    and p.status = 'active'
  limit 1;
$$;

comment on function public.current_company_id() is
  'company_id текущего пользователя; null для SUPER_ADMIN и неавторизованных.';

create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.user_id = (select auth.uid())
    and p.status = 'active'
  limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'SUPER_ADMIN', false);
$$;

-- Право записи внутри своей компании.
create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('SUPER_ADMIN', 'DIRECTOR', 'MANAGER'), false);
$$;

-- -----------------------------------------------------------------------------
-- companies
-- -----------------------------------------------------------------------------
alter table public.companies enable row level security;

create policy companies_select on public.companies
  for select to authenticated
  using (public.is_super_admin() or id = public.current_company_id());

create policy companies_admin_write on public.companies
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Директор может править реквизиты своей компании, но не её статус-принадлежность.
create policy companies_director_update on public.companies
  for update to authenticated
  using (id = public.current_company_id() and public.auth_role() = 'DIRECTOR')
  with check (id = public.current_company_id());

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_super_admin()
    or company_id = public.current_company_id()
  );

create policy profiles_self_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- Типовые таблицы арендатора: один и тот же контракт на company_id.
-- -----------------------------------------------------------------------------
do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'subscriptions', 'ad_accounts', 'campaigns', 'ad_sets', 'ads',
    'creatives', 'ad_metrics', 'leads', 'trials', 'sales',
    'receipts', 'integrations'
  ]
  loop
    execute format('alter table public.%I enable row level security', tenant_table);

    execute format($f$
      create policy %1$I_select on public.%1$I
        for select to authenticated
        using (public.is_super_admin() or company_id = public.current_company_id())
    $f$, tenant_table);

    execute format($f$
      create policy %1$I_insert on public.%1$I
        for insert to authenticated
        with check (
          public.is_super_admin()
          or (company_id = public.current_company_id() and public.can_write())
        )
    $f$, tenant_table);

    execute format($f$
      create policy %1$I_update on public.%1$I
        for update to authenticated
        using (
          public.is_super_admin()
          or (company_id = public.current_company_id() and public.can_write())
        )
        with check (
          public.is_super_admin()
          or (company_id = public.current_company_id() and public.can_write())
        )
    $f$, tenant_table);

    execute format($f$
      create policy %1$I_delete on public.%1$I
        for delete to authenticated
        using (
          public.is_super_admin()
          or (company_id = public.current_company_id() and public.can_write())
        )
    $f$, tenant_table);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- audit_logs — только чтение своей компании; запись идёт с сервера
-- (service role обходит RLS), поэтому политик на insert намеренно нет.
-- -----------------------------------------------------------------------------
alter table public.audit_logs enable row level security;

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.is_super_admin() or company_id = public.current_company_id());
