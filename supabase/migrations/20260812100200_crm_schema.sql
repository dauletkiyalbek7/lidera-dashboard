-- =============================================================================
-- Lidera Final — 03. CRM и сквозная аналитика
-- Лид хранит атрибуцию (креатив/кампания/UTM), поэтому цепочка
-- реклама → лид → пробный → продажа → выручка собирается одним JOIN-ом.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- leads — входящий лид с полной рекламной атрибуцией
-- -----------------------------------------------------------------------------
create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null default '',
  phone        text,
  email        text,
  source       text,  -- 'instagram' | 'whatsapp' | 'site' | 'manual' | ...
  platform     text check (platform in ('meta', 'tiktok', 'google', 'other')),
  campaign_id  uuid references public.campaigns (id) on delete set null,
  ad_set_id    uuid references public.ad_sets (id) on delete set null,
  ad_id        uuid references public.ads (id) on delete set null,
  creative_id  uuid references public.creatives (id) on delete set null,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,
  utm_term     text,
  status       text not null default 'new'
                 check (status in ('new', 'in_progress', 'qualified', 'trial', 'sale', 'rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index leads_company_created_idx on public.leads (company_id, created_at desc);
create index leads_creative_id_idx on public.leads (creative_id);
create index leads_status_idx on public.leads (company_id, status);
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- trials — пробный урок / пробная консультация
-- -----------------------------------------------------------------------------
create table public.trials (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  lead_id    uuid references public.leads (id) on delete cascade,
  status     text not null default 'scheduled'
               check (status in ('scheduled', 'completed', 'no_show', 'canceled')),
  date       date not null default current_date,
  amount     numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trials_company_date_idx on public.trials (company_id, date desc);
create index trials_lead_id_idx on public.trials (lead_id);
create trigger trials_set_updated_at
  before update on public.trials
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- sales — продажа. Источник выручки для ROAS/ROI.
-- -----------------------------------------------------------------------------
create table public.sales (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  lead_id    uuid references public.leads (id) on delete set null,
  product    text,
  amount     numeric(14, 2) not null default 0,
  status     text not null default 'paid'
               check (status in ('pending', 'paid', 'refunded', 'canceled')),
  sale_date  date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sales_company_date_idx on public.sales (company_id, sale_date desc);
create index sales_lead_id_idx on public.sales (lead_id);
create trigger sales_set_updated_at
  before update on public.sales
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- receipts — чеки. Позже наполняется Telegram-ботом + OCR;
-- verification_status держит ручную/автоматическую проверку.
-- -----------------------------------------------------------------------------
create table public.receipts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  lead_id             uuid references public.leads (id) on delete set null,
  sale_id             uuid references public.sales (id) on delete set null,
  file_url            text,
  phone               text,
  amount              numeric(14, 2) not null default 0,
  receipt_date        date,
  transaction_id      text,
  verification_status text not null default 'pending'
                        check (verification_status in ('pending', 'verified', 'rejected')),
  uploaded_by         uuid references public.profiles (id) on delete set null,
  source              text not null default 'manual'
                        check (source in ('manual', 'telegram', 'api')),
  ocr_raw             jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index receipts_company_created_idx on public.receipts (company_id, created_at desc);
create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- integrations — статус подключения внешних систем.
-- Секреты и токены здесь НЕ хранятся в открытом виде: config держит только
-- несекретные настройки, доступ к нему ограничен ролью директора.
-- -----------------------------------------------------------------------------
create table public.integrations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  platform     text not null
                 check (platform in ('meta', 'tiktok', 'telegram', 'whatsapp', 'crm', 'other')),
  status       text not null default 'disconnected'
                 check (status in ('connected', 'disconnected', 'error', 'pending')),
  account_id   text,
  config       jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, platform)
);

create index integrations_company_id_idx on public.integrations (company_id);
create trigger integrations_set_updated_at
  before update on public.integrations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- audit_logs — журнал действий. Пишется только на сервере.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies (id) on delete set null,
  user_id     uuid references auth.users (id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);
