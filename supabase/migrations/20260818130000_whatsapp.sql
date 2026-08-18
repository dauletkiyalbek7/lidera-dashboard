-- =============================================================================
-- Lidera Final — приём переписок WhatsApp через Cloud API
--
-- Что это меняет. Сейчас реклама, ведущая в переписки, даёт только цифру
-- «начато N переписок»: кто написал и с какого объявления — неизвестно, и
-- половина платформы для таких проектов простаивает. Cloud API отдаёт и
-- номер человека, и его первое сообщение, и — если он пришёл с рекламы —
-- идентификатор клика ctwa_clid вместе с номером объявления. Переписка
-- превращается в обычный лид, и дальше работает всё уже готовое: раздача
-- менеджерам, статусы, воронка, продажи, поиск по номеру.
--
-- Схема учитывает опыт работающей системы того же владельца — включая то,
-- что там сделано не так и что её автор сам назвал долгом:
--
--   * подпись Meta там не проверяется вовсе, поэтому у нас секрет приложения
--     хранится с первого дня и проверка обязательна;
--   * токены там лежат открытым текстом — у нас шифруются, как для CAPI;
--   * сырое тело вебхука там не сохраняется, и переиграть неверный разбор
--     не на чем; у нас для этого whatsapp_events, он же даёт защиту от
--     повторной доставки, которой там нет;
--   * идентификатор клика там хранится одним полем и новый клик затирает
--     старый; у нас история переходов лежит в lead_clicks, потому что первый
--     клик объясняет, что человек искал, а последний — тот, за который
--     заплачено.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Подключённые номера.
--
-- Адрес вебхука строится из webhook_key, а не из номера: подпись нужно
-- проверить ДО того, как мы разберём тело и узнаем, о каком номере речь.
-- Ключ в адресе сразу говорит, чьим секретом проверять.
--
-- Если несколько номеров заведены в одном приложении Meta, адрес у них общий:
-- Meta шлёт события всех номеров приложения на один URL, а нужный номер
-- находится внутри по phone_number_id.
-- -----------------------------------------------------------------------------
create table public.whatsapp_numbers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  -- Номер можно закрепить за отделом: написали на номер Куралай — заявка
  -- падает в её отдел, а не в общий котёл.
  department_id uuid references public.departments (id) on delete set null,

  label         text not null default 'Основной',
  -- Как номер выглядит для человека: +7 700 000 00 00.
  display_phone text,
  -- Идентификаторы Meta. По phone_number_id разбираем входящие.
  phone_number_id text not null unique,
  waba_id       text,

  -- Секреты только в зашифрованном виде — в браузер не уходят никогда.
  token_encrypted      text,
  app_secret_encrypted text,
  -- Строка, которую Meta присылает при подключении вебхука.
  verify_token  text not null default encode(gen_random_bytes(16), 'hex'),
  webhook_key   text not null unique default encode(gen_random_bytes(16), 'hex'),

  status        text not null default 'disconnected'
                  check (status in ('connected', 'disconnected', 'error')),
  last_error    text,
  last_message_at timestamptz,

  -- Автоответ. Днём и ночью текст разный: обещать ответ «в течение минуты»
  -- в три часа ночи — способ потерять клиента, а не удержать.
  auto_reply_enabled boolean not null default false,
  auto_reply_day     text,
  auto_reply_night   text,
  -- Пусто — берём рабочие часы и пояс компании.
  work_start_time time,
  work_end_time   time,
  timezone        text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index whatsapp_numbers_company_idx on public.whatsapp_numbers (company_id, status);

create trigger whatsapp_numbers_set_updated_at
  before update on public.whatsapp_numbers
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Сырые события вебхука.
--
-- Пишем тело до разбора и целиком. Это не отладочная роскошь: когда выясняется,
-- что поле разобрано неверно, переиграть разбор можно только по исходнику —
-- иначе история потеряна навсегда. Уникальность по идентификатору сообщения
-- заодно бесплатно защищает от повторной доставки, а Meta повторяет охотно.
-- -----------------------------------------------------------------------------
create table public.whatsapp_events (
  id                 uuid primary key default gen_random_uuid(),
  whatsapp_number_id uuid references public.whatsapp_numbers (id) on delete set null,
  -- Идентификатор сообщения Meta. У событий доставки его нет — отсюда null.
  wa_message_id      text,
  kind               text not null default 'message'
                       check (kind in ('message', 'status', 'other')),
  payload            jsonb not null,
  signature_ok       boolean not null default false,
  processed_at       timestamptz,
  error              text,
  received_at        timestamptz not null default now()
);

-- Одно сообщение — одна запись, сколько бы раз Meta его ни прислала.
create unique index whatsapp_events_message_idx
  on public.whatsapp_events (wa_message_id)
  where wa_message_id is not null;

create index whatsapp_events_received_idx
  on public.whatsapp_events (received_at desc);

-- -----------------------------------------------------------------------------
-- Переписка.
--
-- Отвечать из платформы вручную мы не собираемся — менеджеры работают в боте.
-- Но автоответ уходит от нашего имени, поэтому направление хранится: без него
-- не понять, чьё последнее слово и когда закрывается окно в 24 часа.
-- -----------------------------------------------------------------------------
create table public.whatsapp_messages (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  whatsapp_number_id uuid not null references public.whatsapp_numbers (id) on delete cascade,
  lead_id            uuid references public.leads (id) on delete set null,
  wa_message_id      text,
  direction          text not null check (direction in ('in', 'out')),
  type               text not null default 'text',
  body               text,
  -- Для голосовых, картинок и файлов: сам файл лежит у Meta, у нас ссылка.
  media_id           text,
  status             text not null default 'received'
                       check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  error              text,
  sent_at            timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create unique index whatsapp_messages_wa_id_idx
  on public.whatsapp_messages (wa_message_id)
  where wa_message_id is not null;

create index whatsapp_messages_lead_idx
  on public.whatsapp_messages (lead_id, sent_at desc);
create index whatsapp_messages_company_idx
  on public.whatsapp_messages (company_id, sent_at desc);

-- -----------------------------------------------------------------------------
-- История рекламных переходов.
--
-- Отдельной таблицей, а не полем в карточке. Причина простая: первый клик
-- объясняет, что человек изначально искал, а последний — тот, за который
-- заплачено, и в CAPI уходит именно он. Одно поле хранит только одно из двух,
-- и вторая цифра теряется молча.
-- -----------------------------------------------------------------------------
create table public.lead_clicks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  lead_id     uuid not null references public.leads (id) on delete cascade,
  -- Идентификатор клика по рекламе Click-to-WhatsApp: единственное, чем Meta
  -- сопоставляет будущую покупку с объявлением в этом канале.
  ctwa_clid   text not null,
  ad_external_id text,
  source_type text,
  clicked_at  timestamptz not null default now(),
  unique (lead_id, ctwa_clid)
);

create index lead_clicks_lead_idx on public.lead_clicks (lead_id, clicked_at desc);

-- -----------------------------------------------------------------------------
-- Связь лида с номером и время последнего входящего.
--
-- last_inbound_at нужен, чтобы считать остаток окна в 24 часа прямо в
-- карточке. В той системе счётчика нет, и менеджер узнаёт о закрытом окне
-- только по неудачной отправке — это её автор и назвал слабым местом.
-- -----------------------------------------------------------------------------
alter table public.leads
  add column whatsapp_number_id uuid references public.whatsapp_numbers (id) on delete set null,
  add column last_inbound_at timestamptz;

create index leads_whatsapp_number_idx on public.leads (company_id, whatsapp_number_id);

-- Один человек на одном номере — один лид, сколько бы раз он ни написал.
-- Считаем клиента, а не обращение: иначе продажи и LTV размазываются по дублям.
create unique index leads_whatsapp_phone_idx
  on public.leads (whatsapp_number_id, phone_digits)
  where whatsapp_number_id is not null;

-- -----------------------------------------------------------------------------
-- RLS — те же правила, что у остальных таблиц с company_id.
--
-- whatsapp_events живёт без company_id: события пишет и читает только сервер
-- по служебному ключу, и наружу отдавать их нечем и незачем. Поэтому RLS
-- включён без единой политики — так строка не видна вообще никому, кроме
-- сервера.
-- -----------------------------------------------------------------------------
alter table public.whatsapp_events enable row level security;

alter table public.whatsapp_numbers enable row level security;

create policy whatsapp_numbers_select on public.whatsapp_numbers
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy whatsapp_numbers_write on public.whatsapp_numbers
  for all to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

alter table public.whatsapp_messages enable row level security;

create policy whatsapp_messages_select on public.whatsapp_messages
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy whatsapp_messages_write on public.whatsapp_messages
  for all to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );

alter table public.lead_clicks enable row level security;

create policy lead_clicks_select on public.lead_clicks
  for select to authenticated
  using (private.is_super_admin() or company_id = private.current_company_id());

create policy lead_clicks_write on public.lead_clicks
  for all to authenticated
  using (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  )
  with check (
    private.is_super_admin()
    or (company_id = private.current_company_id() and private.can_write())
  );
