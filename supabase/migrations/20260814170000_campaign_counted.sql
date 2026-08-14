-- Кампании, которые не про продажи.
--
-- В одном кабинете рядом живут курсы и наём: кампания «вакансия» приводит людей,
-- но это не клиенты, и в цене лида ей делать нечего. Считать её вместе с
-- курсами — значит показывать директору неправду.

alter table public.campaigns
  add column if not exists counted boolean not null default true;

comment on column public.campaigns.counted is
  'Учитывать кампанию в отчётах. Найм и прочие непродажные кампании выключают.';

alter table public.campaigns enable row level security;

drop policy if exists campaigns_update_own on public.campaigns;
create policy campaigns_update_own on public.campaigns
  for update using (private.is_super_admin() or company_id = private.current_company_id())
  with check (private.is_super_admin() or company_id = private.current_company_id());
