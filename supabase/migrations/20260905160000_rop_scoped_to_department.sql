-- -----------------------------------------------------------------------------
-- Руководитель отдела ведёт свой отдел, а не всю компанию.
--
-- Отделов продаж у проекта бывает несколько: директор заводит отдел, ставит на
-- него РОПа, и дальше тот набирает людей сам. Пока право РОПа считалось по
-- компании, второй отдел означал бы, что каждый руководитель распоряжается
-- чужими людьми — увольняет, переводит, меняет график.
--
-- Правило: РОП заводит и правит только менеджеров и продажников своего отдела.
-- «Своего» считается через `is not distinct from`: пока отделов нет, у всех
-- стоит пусто, и это тоже один общий отдел — сегодняшняя работа не ломается.
--
-- Директора это не касается: у него карточки сотрудника нет, и он ведёт всех.
-- Видеть чужие карточки РОП по-прежнему может: имена продавцов и менеджеров
-- нужны в отчётах и списках, а распоряжаться ими — уже нет.
-- -----------------------------------------------------------------------------

create or replace function private.current_employee_department()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select e.department_id
    from public.employees e
   where e.id = private.current_employee_id();
$$;

-- Право на вызов нужно самой роли, которая делает запрос: политика проверяет
-- функцию от её имени, и без этого раздел отвечает «permission denied».
revoke all on function private.current_employee_department() from public, anon;
grant execute on function private.current_employee_department() to authenticated;

-- Поиск «мои люди» идёт по отделу.
create index if not exists employees_department_idx
  on public.employees (company_id, department_id);

drop policy if exists employees_insert on public.employees;
drop policy if exists employees_update on public.employees;
drop policy if exists employees_delete on public.employees;

create policy employees_insert on public.employees
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or (
          private.is_sales_lead()
          and private.is_subordinate_role(role)
          and department_id is not distinct from private.current_employee_department()
        )
      )
    )
  );

create policy employees_update on public.employees
  for update to authenticated
  using (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or (
          private.is_sales_lead()
          and private.is_subordinate_role(role)
          and department_id is not distinct from private.current_employee_department()
        )
      )
    )
  )
  with check (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or (
          private.is_sales_lead()
          and private.is_subordinate_role(role)
          and department_id is not distinct from private.current_employee_department()
        )
      )
    )
  );

create policy employees_delete on public.employees
  for delete to authenticated
  using (
    private.is_super_admin()
    or (
      company_id = private.current_company_id()
      and (
        private.can_write()
        or (
          private.is_sales_lead()
          and private.is_subordinate_role(role)
          and department_id is not distinct from private.current_employee_department()
        )
      )
    )
  );
