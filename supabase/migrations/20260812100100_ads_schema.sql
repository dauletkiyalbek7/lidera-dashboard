-- =============================================================================
-- Lidera Final — 02. Рекламная иерархия
-- ad_account → campaign → ad_set → ad → creative, плюс дневные метрики.
-- Структура повторяет модель Meta Marketing API / TikTok Ads API, поэтому
-- реальную синхронизацию можно включить без изменения схемы: внешние
-- идентификаторы площадок хранятся в external_id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ad_accounts — подключённый рекламный кабинет компании
-- -----------------------------------------------------------------------------
create table public.ad_accounts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  platform     text not null check (platform in ('meta', 'tiktok', 'google', 'other')),
  account_name text not null,
  account_id   text,
  status       text not null default 'disconnected'
                 check (status in ('connected', 'disconnected', 'error')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, platform, account_id)
);

create index ad_accounts_company_id_idx on public.ad_accounts (company_id);
create trigger ad_accounts_set_updated_at
  before update on public.ad_accounts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- campaigns
-- -----------------------------------------------------------------------------
create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  ad_account_id uuid references public.ad_accounts (id) on delete set null,
  external_id   text,
  name          text not null,
  platform      text not null check (platform in ('meta', 'tiktok', 'google', 'other')),
  status        text not null default 'active'
                  check (status in ('active', 'paused', 'archived')),
  objective     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, platform, external_id)
);

create index campaigns_company_id_idx on public.campaigns (company_id);
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ad_sets
-- -----------------------------------------------------------------------------
create table public.ad_sets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  external_id text,
  name        text not null,
  status      text not null default 'active'
                check (status in ('active', 'paused', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, external_id)
);

create index ad_sets_company_id_idx on public.ad_sets (company_id);
create index ad_sets_campaign_id_idx on public.ad_sets (campaign_id);
create trigger ad_sets_set_updated_at
  before update on public.ad_sets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- creatives — креатив (видео/баннер). Ключевая сущность сквозной аналитики:
-- именно к нему сводятся расход, лиды, пробные, продажи и выручка.
-- -----------------------------------------------------------------------------
create table public.creatives (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  external_id text,
  name        text not null,
  preview_url text,
  thumbnail_url text,
  format      text check (format in ('video', 'image', 'carousel', 'other')),
  platform    text not null check (platform in ('meta', 'tiktok', 'google', 'other')),
  status      text not null default 'active'
                check (status in ('active', 'paused', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, platform, external_id)
);

create index creatives_company_id_idx on public.creatives (company_id);
create trigger creatives_set_updated_at
  before update on public.creatives
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ads
-- -----------------------------------------------------------------------------
create table public.ads (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  ad_set_id   uuid references public.ad_sets (id) on delete cascade,
  creative_id uuid references public.creatives (id) on delete set null,
  external_id text,
  name        text not null,
  status      text not null default 'active'
                check (status in ('active', 'paused', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, external_id)
);

create index ads_company_id_idx on public.ads (company_id);
create index ads_ad_set_id_idx on public.ads (ad_set_id);
create index ads_creative_id_idx on public.ads (creative_id);
create trigger ads_set_updated_at
  before update on public.ads
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ad_metrics — дневной срез метрик по креативу.
-- Единственный источник цифр расхода/показов/кликов для дашбордов:
-- сейчас наполняется демо-данными, позже — синхронизацией с Meta/TikTok.
-- Производные (ctr, cpc, cpm, cpl) хранятся денормализованно, как их
-- отдают рекламные API.
-- -----------------------------------------------------------------------------
create table public.ad_metrics (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  creative_id uuid references public.creatives (id) on delete cascade,
  ad_id       uuid references public.ads (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  platform    text not null default 'meta'
                check (platform in ('meta', 'tiktok', 'google', 'other')),
  date        date not null,
  spend       numeric(14, 2) not null default 0,
  impressions bigint not null default 0,
  reach       bigint not null default 0,
  clicks      bigint not null default 0,
  ctr         numeric(8, 4) not null default 0,
  cpc         numeric(14, 2) not null default 0,
  cpm         numeric(14, 2) not null default 0,
  leads       integer not null default 0,
  cpl         numeric(14, 2) not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, creative_id, date)
);

create index ad_metrics_company_date_idx on public.ad_metrics (company_id, date);
create index ad_metrics_creative_id_idx on public.ad_metrics (creative_id);
