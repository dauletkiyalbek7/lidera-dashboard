-- Приём заявок с сайта.
--
-- У каждой компании свой адрес приёма: конструкторы форм (Tilda и подобные)
-- не умеют слать заголовки, поэтому ключ живёт в самом адресе. Ключ даёт право
-- только создать лид — прочитать через него ничего нельзя.

alter table public.companies
  add column if not exists lead_webhook_key text unique;

update public.companies
   set lead_webhook_key = encode(gen_random_bytes(16), 'hex')
 where lead_webhook_key is null;

comment on column public.companies.lead_webhook_key is
  'Ключ адреса приёма заявок с сайта: /api/forms/<key>.';

-- Метки клика по рекламе. Без них Meta не свяжет покупку с объявлением:
-- fbc рождается из fbclid в адресе лендинга, fbp — из куки пикселя.
alter table public.leads
  add column if not exists fbc text,
  add column if not exists fbp text,
  -- Номер отправки формы: защита от повторной заявки при ретрае вебхука.
  add column if not exists external_id text;

create unique index if not exists leads_company_external_id_idx
  on public.leads (company_id, external_id)
  where external_id is not null;

comment on column public.leads.fbc is
  'Метка клика по объявлению (fb.1.<время>.<fbclid>) — для событий CAPI.';
