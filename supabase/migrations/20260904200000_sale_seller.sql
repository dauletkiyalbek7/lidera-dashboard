-- -----------------------------------------------------------------------------
-- Продавец записывается в саму продажу.
--
-- До сих пор «кто продал» вычислялось через клиента: продажа связана с
-- заявкой, заявка — с сотрудником. Цепочка рвётся от любого движения: заявку
-- передали другому менеджеру — продажа молча переехала в его отчёт; карточку
-- сотрудника удалили — продажа стала ничьей, и выручка за прошлый месяц
-- перестала числиться за кем бы то ни было.
--
-- Поэтому продавец фиксируется в момент продажи и дальше не меняется. Имя
-- хранится рядом с ссылкой намеренно: ссылка обнулится вместе с карточкой,
-- а имя в отчёте за прошлый год должно остаться.
-- -----------------------------------------------------------------------------

alter table public.sales
  add column if not exists seller_id uuid references public.employees (id) on delete set null,
  add column if not exists seller_name text;

create index if not exists sales_seller_idx on public.sales (company_id, seller_id);

-- Прошлые продажи: подставляем того, за кем заявка числится сейчас. Это
-- единственное, что о них известно, и это лучше, чем пусто.
update public.sales s
   set seller_id = l.assigned_to,
       seller_name = e.full_name
  from public.leads l
  join public.employees e on e.id = l.assigned_to
 where s.lead_id = l.id
   and s.seller_id is null;

comment on column public.sales.seller_id is
  'Кто закрыл продажу. Обнуляется при удалении карточки — имя остаётся в seller_name.';
comment on column public.sales.seller_name is
  'Имя продавца на момент продажи. Снимок: не меняется и переживает удаление сотрудника.';
