-- -----------------------------------------------------------------------------
-- РОП набирает и ведёт свой отдел.
--
-- До сих пор карточку сотрудника мог завести только директор: право на запись
-- в employees давал can_write(), а он смотрит на роль входа, и у любого
-- сотрудника она EMPLOYEE. Для агентства это узкое место — людей нанимает
-- руководитель отдела продаж, а не владелец.
--
-- Право выдаётся ровно на подчинённых: менеджеров и продажников. Ни завести
-- второго РОПа, ни тронуть таргетолога, ни изменить собственную роль он не
-- может — иначе «руководитель отдела» за одно нажатие превращался бы в
-- руководителя компании.
-- -----------------------------------------------------------------------------

create or replace function private.is_sales_lead()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.current_employee_role() = 'rop';
$$;

-- Право на вызов обязательно: внутри политики Postgres проверяет его от имени
-- того, кто делает запрос, и без гранта раздел отвечает отказом, а не данными.
grant execute on function private.is_sales_lead() to authenticated;

-- Подчинённые РОПа. Роль РОПа и таргетолога сюда намеренно не входят.
create or replace function private.is_subordinate_role(role text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select role in ('manager', 'salesperson');
$$;

grant execute on function private.is_subordinate_role(text) to authenticated;

-- employees ---------------------------------------------------------------

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or (private.is_sales_lead() and private.is_subordinate_role(role))
      )
    )
  );

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update to authenticated
  using (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or (private.is_sales_lead() and private.is_subordinate_role(role))
      )
    )
  )
  with check (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or (private.is_sales_lead() and private.is_subordinate_role(role))
      )
    )
  );

drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees
  for delete to authenticated
  using (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or (private.is_sales_lead() and private.is_subordinate_role(role))
      )
    )
  );

-- leads -------------------------------------------------------------------
-- Увольнение освобождает открытые заявки ушедшего, а раздача отдаёт их тем,
-- кто на смене. Без права на запись увольнение оставляло бы клиентов висеть
-- на человеке, которого уже нет.

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        (private.can_write() and private.sees_whole_company())
        or private.is_sales_lead()
        or assigned_to = private.current_employee_id()
      )
    )
  );

-- lead_assignments --------------------------------------------------------
-- Журнал передач: без записи в него спор «мне клиент не приходил» разобрать
-- нечем, а очередь раздачи считается неверно.

drop policy if exists lead_assignments_insert on public.lead_assignments;
create policy lead_assignments_insert on public.lead_assignments
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (private.can_write() or private.is_sales_lead())
    )
  );

drop policy if exists lead_assignments_update on public.lead_assignments;
create policy lead_assignments_update on public.lead_assignments
  for update to authenticated
  using (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (private.can_write() or private.is_sales_lead())
    )
  )
  with check (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (private.can_write() or private.is_sales_lead())
    )
  );

-- employee_invites --------------------------------------------------------
-- Приглашение в бота — часть найма: человек заведён и сразу получает ссылку.

drop policy if exists employee_invites_insert on public.employee_invites;
create policy employee_invites_insert on public.employee_invites
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or private.is_sales_lead()
        or employee_id = private.current_employee_id()
      )
    )
  );

drop policy if exists employee_invites_update on public.employee_invites;
create policy employee_invites_update on public.employee_invites
  for update to authenticated
  using (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or private.is_sales_lead()
        or employee_id = private.current_employee_id()
      )
    )
  );
