-- -----------------------------------------------------------------------------
-- Менеджер видит только своих клиентов.
--
-- До сих пор любой сотрудник компании читал весь список заявок: правило
-- проверяло только компанию. Для отдела в три человека это терпимо, для
-- двадцати — нет, а главное, база чужие строки всё равно отдавала, и защита
-- держалась на том, что интерфейс их не показывает. Так нельзя: правило
-- должно стоять в самой базе.
--
-- Кто что видит:
--   директор (карточки сотрудника нет)  — всё;
--   РОП и маркетолог                    — всё, это их работа;
--   менеджер                            — заявки, выданные ему;
--   продажник                           — свои заявки и тех клиентов, чей
--                                         пробный урок ведёт он.
-- -----------------------------------------------------------------------------

create or replace function private.current_employee_role()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select e.role
    from public.employees e
   where e.id = private.current_employee_id();
$$;

revoke all on function private.current_employee_role() from public, anon, authenticated;

-- Продажник ищет клиента по уроку — без этого условие ниже читало бы всю
-- таблицу уроков на каждую заявку.
create index if not exists trials_lead_seller_idx
  on public.trials (lead_id, assigned_to);

drop policy if exists leads_select on public.leads;

create policy leads_select on public.leads
  for select to authenticated
  using (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        -- Руководитель: карточки сотрудника у него нет.
        private.current_employee_id() is null
        or private.current_employee_role() in ('rop', 'targetolog')
        or assigned_to = private.current_employee_id()
        or exists (
          select 1
            from public.trials t
           where t.lead_id = leads.id
             and t.assigned_to = private.current_employee_id()
        )
      )
    )
  );
