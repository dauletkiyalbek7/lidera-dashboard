-- Пересчёт валют.
--
-- Рекламный кабинет выставляет счета в своей валюте (у Meta это валюта
-- аккаунта), а кабинет компании показывает деньги в валюте компании. Раньше
-- сумма просто подписывалась другим знаком — доллары «становились» тенге без
-- пересчёта. Теперь у каждой суммы расхода есть своя валюта, а курс хранится
-- по дням: расход за 3 июля считается по курсу 3 июля, а не по сегодняшнему.

-- Валюта, в которой пришёл расход. NULL = валюта компании (демо-данные и
-- ручные записи).
alter table public.ad_metrics
  add column if not exists currency text
    check (currency is null or currency in ('KZT', 'USD', 'EUR', 'RUB'));

comment on column public.ad_metrics.currency is
  'Валюта поля spend — валюта рекламного кабинета. NULL: валюта компании.';

-- Валюта рекламного кабинета, чтобы её было видно в разделе «Реклама».
alter table public.ad_accounts
  add column if not exists currency text
    check (currency is null or currency in ('KZT', 'USD', 'EUR', 'RUB'));

-- Курсы Нацбанка РК: сколько тенге стоит одна единица валюты в этот день.
-- Тенге здесь опорная валюта, любая пара считается через неё.
create table if not exists public.exchange_rates (
  date         date not null,
  code         text not null check (code in ('USD', 'EUR', 'RUB')),
  kzt_per_unit numeric(14, 6) not null check (kzt_per_unit > 0),
  source       text not null default 'nationalbank.kz',
  fetched_at   timestamptz not null default now(),
  primary key (date, code)
);

comment on table public.exchange_rates is
  'Курсы Нацбанка РК по дням. Пишет только сервер (синхронизация), читают все вошедшие.';

alter table public.exchange_rates enable row level security;

-- Курс — общий справочник, а не данные компании: он одинаков для всех и не
-- раскрывает ничего чужого. Поэтому читать может любой вошедший, а писать —
-- только сервер сервисным ключом (он политики не проходит).
drop policy if exists exchange_rates_read on public.exchange_rates;
create policy exchange_rates_read on public.exchange_rates
  for select using (auth.uid() is not null);

create index if not exists exchange_rates_code_date_idx
  on public.exchange_rates (code, date desc);
