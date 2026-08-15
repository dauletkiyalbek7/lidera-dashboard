-- Журнал входящих заявок с сайта.
--
-- Раньше отклонённая заявка не оставляла следа: в Tilda её видно, у нас нет,
-- и ответить «почему у них 21, а у нас 15» было нечем. Пишем сюда каждый
-- вызов вебхука вместе с телом запроса — тогда потеря становится видимой
-- сразу, а не через сверку таблиц вручную.
create table if not exists form_submissions (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  lead_id    uuid references leads(id) on delete set null,
  status     text not null check (status in ('saved', 'duplicate', 'rejected', 'error')),
  reason     text,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists form_submissions_company_created_idx
  on form_submissions (company_id, created_at desc);

alter table form_submissions enable row level security;

-- Читает только своя компания: в теле запроса лежат телефоны клиентов.
-- Пишет сервисный ключ вебхука, поэтому политики на запись не нужны.
create policy form_submissions_select on form_submissions for select
  using (private.is_super_admin() or company_id = private.current_company_id());
