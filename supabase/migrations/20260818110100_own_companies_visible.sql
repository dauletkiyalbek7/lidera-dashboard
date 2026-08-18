-- =============================================================================
-- Lidera Final — свои проекты видно списком, а не только открытый
--
-- Переключателю нужны названия всех проектов входа, а companies_select отдавал
-- ровно один — тот, что открыт сейчас. Получалось, что второй проект невидим
-- для собственного владельца, и переключиться на него не из чего.
--
-- Доступ к данным это не расширяет: остальные 90 политик по-прежнему
-- спрашивают current_company_id(), то есть открытый проект. Видно только то,
-- что у человека такой проект есть.
-- =============================================================================

create or replace function private.belongs_to_company(target uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = (select auth.uid())
       and p.company_id = target
       and p.status = 'active'
  );
$$;

drop policy companies_select on public.companies;

create policy companies_select on public.companies
  for select to authenticated
  using (private.is_super_admin() or private.belongs_to_company(id));
