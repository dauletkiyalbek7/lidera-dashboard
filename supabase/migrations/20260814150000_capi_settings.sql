-- Настройки Conversions API: куда и чем отправлять события покупок.
--
-- Токен здесь лежит зашифрованным и не читается ни директором, ни через RLS:
-- политик у таблицы нет вовсе, поэтому доступ есть только у сервера с сервисным
-- ключом. Директору токен видеть незачем — он вводит его один раз через админа.

create table if not exists public.capi_settings (
  company_id      uuid primary key references public.companies (id) on delete cascade,
  dataset_id      text not null,
  token_encrypted text not null,
  /** Код тестовых событий из Events Manager: события видно, но в обучение не идут. */
  test_event_code text,
  enabled         boolean not null default true,
  last_event_at   timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.capi_settings is
  'Набор данных и токен для отправки событий покупок в Meta. Только сервер.';

alter table public.capi_settings enable row level security;
-- Политик нет намеренно: ни один пользовательский запрос сюда не проходит.

-- Событие покупки, отправленное в Meta: чтобы не отправить дважды и чтобы было
-- видно, что именно ушло.
create table if not exists public.capi_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  sale_id     uuid references public.sales (id) on delete set null,
  event_name  text not null,
  event_id    text not null,
  value       numeric(14, 2),
  currency    text,
  status      text not null check (status in ('sent', 'failed')),
  response    text,
  created_at  timestamptz not null default now(),
  unique (company_id, event_id)
);

alter table public.capi_events enable row level security;

-- Журнал отправок компания видит: это её продажи и её реклама.
drop policy if exists capi_events_read on public.capi_events;
create policy capi_events_read on public.capi_events
  for select using (private.is_super_admin() or company_id = private.current_company_id());
