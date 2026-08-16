-- Возвраты. Оформляет РОП или директор.
--
-- Статуса «возврат» у продажи мало: он не помнит, кто оформил, когда и почему.
-- Эти три вещи и нужны в разборе — деньги вернулись не сами по себе. Строку
-- никогда не удаляем: она и есть история.
create table returns (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  sale_id      uuid not null references sales(id) on delete cascade,
  amount       numeric not null default 0,
  currency     text,
  reason       text,
  processed_by uuid references employees(id),
  created_at   timestamptz not null default now(),
  -- Одна продажа возвращается один раз: частичных возвратов пока нет.
  unique (sale_id)
);

create index returns_company_date on returns (company_id, created_at);

alter table returns enable row level security;

create policy returns_select on returns for select
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy returns_insert on returns for insert
  with check (private.is_super_admin() or (company_id = private.current_company_id() and private.can_write()));

create policy returns_update on returns for update
  using (private.is_super_admin() or (company_id = private.current_company_id() and private.can_write()));

create policy returns_delete on returns for delete
  using (private.is_super_admin() or (company_id = private.current_company_id() and private.can_write()));
