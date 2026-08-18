-- =============================================================================
-- Lidera Final — источники лидов: свой адрес приёма на каждый поток заявок
--
-- Раньше адрес приёма был один на компанию: у проекта был один лендинг, и
-- вопроса «откуда пришла заявка» не возникало. У Дарына потоков сразу
-- несколько — по одной выгрузке на отдел продаж и на площадку: два отдела
-- NIS на Facebook, два их же на TikTok, и по одному у UBT. Шесть потоков,
-- и каждый должен приземляться в свой отдел.
--
-- Разделять их внутри одного адреса нечем: сервис-посредник шлёт голые поля
-- формы, без пометки, из какой он выгрузки. Поэтому пометка живёт в самом
-- адресе — свой ключ на поток. Ключ по-прежнему даёт право только создать
-- лид, прочитать им нельзя ничего.
-- =============================================================================

create table public.lead_sources (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  -- Пусто — заявки идут в компанию целиком, без разделения по отделам.
  department_id uuid references public.departments (id) on delete set null,
  name          text not null,
  platform      text not null default 'other'
                  check (platform in ('meta', 'tiktok', 'google', 'site', 'whatsapp', 'other')),
  webhook_key   text not null unique
                  default encode(gen_random_bytes(16), 'hex'),
  -- Поток можно закрыть, не теряя привязку уже пришедших заявок.
  status        text not null default 'active'
                  check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, name)
);

create index lead_sources_company_idx on public.lead_sources (company_id, status);

create trigger lead_sources_set_updated_at
  before update on public.lead_sources
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Переносим действующие адреса, чтобы механизм остался один.
--
-- Ключи не перевыпускаем: они уже вставлены в Tilda и в сервисы-посредники,
-- и смена ключа молча оборвала бы приём заявок у работающих проектов.
-- -----------------------------------------------------------------------------
insert into public.lead_sources (company_id, name, platform, webhook_key)
select id, 'Форма на сайте', 'site', lead_webhook_key
  from public.companies
 where lead_webhook_key is not null;

-- Новая компания раньше оставалась вовсе без ключа: колонку заполняла разовая
-- миграция, а код при создании его не выдавал.
alter table public.companies
  alter column lead_webhook_key set default encode(gen_random_bytes(16), 'hex');

update public.companies
   set lead_webhook_key = encode(gen_random_bytes(16), 'hex')
 where lead_webhook_key is null;

-- -----------------------------------------------------------------------------
-- Метки на лиде.
--
--   lead_source_id — из какого потока пришла заявка;
--   leadgen_id     — номер заявки в моментальной форме Meta. Именно по нему
--                    Meta сопоставляет будущую покупку с объявлением, поэтому
--                    без него события CAPI бьются только по телефону.
-- -----------------------------------------------------------------------------
alter table public.leads
  add column lead_source_id uuid references public.lead_sources (id) on delete set null,
  add column leadgen_id     text;

create index leads_source_idx on public.leads (company_id, lead_source_id);

-- Одна и та же заявка не должна раздвоиться, если выгрузку прислали дважды.
create unique index leads_company_leadgen_idx
  on public.leads (company_id, leadgen_id)
  where leadgen_id is not null;

comment on column public.leads.leadgen_id is
  'Номер заявки в моментальной форме Meta — ключ сопоставления для CAPI.';

-- -----------------------------------------------------------------------------
-- RLS — те же правила, что у остальных таблиц с company_id
-- -----------------------------------------------------------------------------
alter table public.lead_sources enable row level security;

create policy lead_sources_select on public.lead_sources
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy lead_sources_insert on public.lead_sources
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy lead_sources_update on public.lead_sources
  for update to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

create policy lead_sources_delete on public.lead_sources
  for delete to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );
