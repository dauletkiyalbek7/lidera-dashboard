-- Итоги по суткам рекламного кабинета, как их считает сам кабинет.
--
-- В ad_metrics цифры разложены по нашим суткам: кабинет живёт в другом поясе,
-- и его день начинается в 23:00 по Алматы. Это правильно для сверки с CRM, но
-- директор сравнивает раздел «Реклама» с Ads Manager и видит разные числа.
-- Здесь лежит второе прочтение тех же часов — по календарю кабинета, чтобы
-- показать его рядом мелкой строкой.
create table ad_account_days (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  platform      text not null default 'meta',
  date          date not null,
  leads         integer not null default 0,
  spend         numeric not null default 0,
  impressions   integer not null default 0,
  clicks        integer not null default 0,
  currency      text,
  created_at    timestamptz not null default now(),
  unique (ad_account_id, date)
);

create index ad_account_days_company_date on ad_account_days (company_id, date);

alter table ad_account_days enable row level security;

create policy ad_account_days_select on ad_account_days for select
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy ad_account_days_insert on ad_account_days for insert
  with check (private.is_super_admin() or (company_id = private.current_company_id() and private.can_write()));

create policy ad_account_days_update on ad_account_days for update
  using (private.is_super_admin() or (company_id = private.current_company_id() and private.can_write()));

create policy ad_account_days_delete on ad_account_days for delete
  using (private.is_super_admin() or (company_id = private.current_company_id() and private.can_write()));
