-- =============================================================================
-- Lidera Final — 05. Ужесточение доступа к служебным функциям
--
-- Функции RLS переезжают из public в схему private: PostgREST отдаёт наружу
-- только public, поэтому в private они перестают быть вызываемыми через
-- /rest/v1/rpc, но по-прежнему доступны политикам.
-- Плюс set_updated_at получает фиксированный search_path.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Служебные функции — те же тела, новая схема
-- -----------------------------------------------------------------------------
create or replace function private.current_company_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.company_id from public.profiles p
  where p.user_id = (select auth.uid()) and p.status = 'active' limit 1;
$$;

create or replace function private.auth_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.user_id = (select auth.uid()) and p.status = 'active' limit 1;
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.auth_role() = 'SUPER_ADMIN', false);
$$;

create or replace function private.can_write()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.auth_role() in ('SUPER_ADMIN', 'DIRECTOR', 'MANAGER'), false);
$$;

-- -----------------------------------------------------------------------------
-- Политики пересоздаются на новые функции
-- -----------------------------------------------------------------------------
drop policy if exists companies_select on public.companies;
drop policy if exists companies_admin_write on public.companies;
drop policy if exists companies_director_update on public.companies;

create policy companies_select on public.companies
  for select to authenticated
  using (private.is_super_admin() or id = private.current_company_id());

create policy companies_admin_write on public.companies
  for all to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

create policy companies_director_update on public.companies
  for update to authenticated
  using (id = private.current_company_id() and private.auth_role() = 'DIRECTOR')
  with check (id = private.current_company_id());

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_write on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_super_admin()
    or company_id = private.current_company_id()
  );

create policy profiles_self_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

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
    execute format('drop policy if exists %1$I_select on public.%1$I', tenant_table);
    execute format('drop policy if exists %1$I_insert on public.%1$I', tenant_table);
    execute format('drop policy if exists %1$I_update on public.%1$I', tenant_table);
    execute format('drop policy if exists %1$I_delete on public.%1$I', tenant_table);

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

drop policy if exists audit_logs_select on public.audit_logs;

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

-- -----------------------------------------------------------------------------
-- Публичные копии больше не нужны
-- -----------------------------------------------------------------------------
drop function if exists public.can_write();
drop function if exists public.is_super_admin();
drop function if exists public.current_company_id();
drop function if exists public.auth_role();

-- Триггерная функция: фиксируем search_path
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
