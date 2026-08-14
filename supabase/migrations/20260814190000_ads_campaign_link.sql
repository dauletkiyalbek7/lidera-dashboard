-- Кампания у объявления.
--
-- Заявка с сайта приходит с меткой {{ad.id}}. Чтобы она попала не только в свой
-- креатив, но и в отчёт своей кампании, объявление должно знать, к какой
-- кампании принадлежит.

alter table public.ads
  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;

comment on column public.ads.campaign_id is
  'Кампания объявления: по ней заявка с сайта попадает в отчёт нужной кампании.';

create index if not exists ads_company_external_idx
  on public.ads (company_id, external_id);
