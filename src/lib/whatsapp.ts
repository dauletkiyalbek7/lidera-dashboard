import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { minutesOfDay } from '@/lib/attendance';
import { decryptSecret } from '@/lib/secrets';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Приём переписок WhatsApp через Cloud API.
 *
 * Реклама, ведущая в переписки, до сих пор давала одну цифру — «начато N
 * переписок». Здесь она превращается в обычные лиды: номер человека, его
 * первое сообщение и, если он пришёл с рекламы, объявление, которое его
 * привело. Дальше работает всё уже готовое — раздача, статусы, продажи.
 *
 * Всё, что тут написано, крутится вокруг четырёх правил, и каждое оплачено
 * чужим опытом:
 *
 *   1. Подпись Meta проверяется всегда. Без неё адрес вебхука — открытая
 *      дверь: кто его знает, тот подбрасывает лиды.
 *   2. Сырое тело сохраняется до разбора. Когда разбор оказывается неверным,
 *      переиграть его можно только по исходнику.
 *   3. Один человек на одном номере — один лид. Считаем клиента, а не
 *      обращение, иначе продажи и LTV размазываются по дублям.
 *   4. Отвечаем Meta 200 всегда, даже когда у нас всё упало. Иначе она
 *      начнёт повторять и завалит повторами.
 */

const API_VERSION = 'v21.0';

/** Сутки — окно, в котором WhatsApp разрешает свободно отвечать клиенту. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Рабочие часы по умолчанию, если их не задали ни номеру, ни компании. */
const DEFAULT_DAY_START = '09:00';
const DEFAULT_DAY_END = '21:00';
const DEFAULT_TIME_ZONE = 'Asia/Almaty';

type Supabase = ReturnType<typeof createAdminSupabase>;

/**
 * Подпись Meta.
 *
 * Считается по СЫРОМУ телу запроса: любая пересборка JSON меняет байты, и
 * подпись перестаёт сходиться. Сравнение — постоянное по времени, чтобы по
 * скорости ответа нельзя было подобрать подпись по байту.
 */
export function signatureValid(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const received = Buffer.from(header.slice('sha256='.length), 'hex');

  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}

export type NumberRecord = {
  id: string;
  companyId: string;
  departmentId: string | null;
  phoneNumberId: string;
  verifyToken: string;
  /** Отключённый номер ничего не принимает: кнопка в интерфейсе не должна врать. */
  status: string;
  appSecret: string | null;
  token: string | null;
  autoReplyEnabled: boolean;
  autoReplyDay: string | null;
  autoReplyNight: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  timeZone: string | null;
};

/**
 * Номер по ключу из адреса вебхука.
 *
 * Ключ нужен именно в адресе: подпись надо проверить ДО разбора тела, то есть
 * до того, как мы вообще узнаем, о каком номере речь.
 */
export async function numberByWebhookKey(
  supabase: Supabase,
  key: string,
): Promise<NumberRecord | null> {
  const { data } = await supabase
    .from('whatsapp_numbers')
    .select(
      'id, company_id, department_id, phone_number_id, verify_token, status, app_secret_encrypted, token_encrypted, auto_reply_enabled, auto_reply_day, auto_reply_night, work_start_time, work_end_time, timezone',
    )
    .eq('webhook_key', key)
    .maybeSingle();

  return data ? toRecord(data) : null;
}

/**
 * Номер, которому адресовано событие.
 *
 * Ищем в пределах той же компании, что и ключ из адреса: несколько номеров
 * одного приложения Meta шлют события на общий URL, и разбирать их надо по
 * phone_number_id, но выходить за компанию при этом нельзя.
 */
async function numberByPhoneNumberId(
  supabase: Supabase,
  companyId: string,
  phoneNumberId: string,
): Promise<NumberRecord | null> {
  const { data } = await supabase
    .from('whatsapp_numbers')
    .select(
      'id, company_id, department_id, phone_number_id, verify_token, status, app_secret_encrypted, token_encrypted, auto_reply_enabled, auto_reply_day, auto_reply_night, work_start_time, work_end_time, timezone',
    )
    .eq('company_id', companyId)
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();

  return data ? toRecord(data) : null;
}

/** Номер по идентификатору — для отправки из раздела «Переписки». */
export async function numberById(
  supabase: Supabase,
  companyId: string,
  id: string,
): Promise<NumberRecord | null> {
  const { data } = await supabase
    .from('whatsapp_numbers')
    .select(
      'id, company_id, department_id, phone_number_id, verify_token, status, app_secret_encrypted, token_encrypted, auto_reply_enabled, auto_reply_day, auto_reply_night, work_start_time, work_end_time, timezone',
    )
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle();

  return data ? toRecord(data) : null;
}

type NumberRow = {
  id: string;
  company_id: string;
  department_id: string | null;
  phone_number_id: string;
  verify_token: string;
  status: string;
  app_secret_encrypted: string | null;
  token_encrypted: string | null;
  auto_reply_enabled: boolean;
  auto_reply_day: string | null;
  auto_reply_night: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  timezone: string | null;
};

function toRecord(row: NumberRow): NumberRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    departmentId: row.department_id,
    phoneNumberId: row.phone_number_id,
    verifyToken: row.verify_token,
    status: row.status,
    // Секрет нечитаем — значит его ввели при другом ключе шифрования. Это не
    // повод ронять приём: разберёмся выше, а событие всё равно сохраним.
    appSecret: readSecret(row.app_secret_encrypted),
    token: readSecret(row.token_encrypted),
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyDay: row.auto_reply_day,
    autoReplyNight: row.auto_reply_night,
    workStartTime: row.work_start_time,
    workEndTime: row.work_end_time,
    timeZone: row.timezone,
  };
}

function readSecret(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

/** Тело вебхука. Описываем только то, что действительно разбираем. */
type Referral = {
  source_id?: string;
  source_type?: string;
  ctwa_clid?: string;
};

type InboundMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  referral?: Referral;
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
  video?: { id?: string; caption?: string };
  document?: { id?: string; filename?: string };
};

type StatusUpdate = {
  id?: string;
  status?: string;
  errors?: { title?: string; message?: string }[];
};

type WebhookValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: InboundMessage[];
  statuses?: StatusUpdate[];
};

export type WebhookBody = {
  entry?: { changes?: { field?: string; value?: WebhookValue }[] }[];
};

export type ProcessResult = { messages: number; statuses: number; skipped: number };

/**
 * Разбор события вебхука.
 *
 * Сырое тело к этому моменту уже сохранено — здесь только разбор. Ошибка на
 * одном сообщении не должна ронять остальные: их в одном событии бывает
 * несколько, и терять три из-за четвёртого нельзя.
 */
export async function processWebhook(
  supabase: Supabase,
  keyNumber: NumberRecord,
  body: WebhookBody,
): Promise<ProcessResult> {
  const result: ProcessResult = { messages: 0, statuses: 0, skipped: 0 };

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      const target = phoneNumberId
        ? await numberByPhoneNumberId(supabase, keyNumber.companyId, phoneNumberId)
        : null;

      // Событие чужого номера. Молча выбрасывать нельзя — это чаще всего
      // признак того, что номер завели в Meta, но не добавили на платформу.
      //
      // Отключённый номер тоже пропускаем: иначе кнопка «Отключить» ничего бы
      // не значила, а заявки продолжали бы падать. Событие при этом уже
      // сохранено в журнале — видно, что Meta стучится, и приём можно включить.
      if (!target || target.status !== 'connected') {
        result.skipped += (value.messages?.length ?? 0) + (value.statuses?.length ?? 0);
        continue;
      }

      const profileName = value.contacts?.[0]?.profile?.name ?? null;

      for (const message of value.messages ?? []) {
        try {
          const saved = await handleMessage(supabase, target, message, profileName);
          if (saved) result.messages += 1;
          else result.skipped += 1;
        } catch {
          result.skipped += 1;
        }
      }

      for (const status of value.statuses ?? []) {
        try {
          await handleStatus(supabase, status);
          result.statuses += 1;
        } catch {
          result.skipped += 1;
        }
      }
    }
  }

  return result;
}

/**
 * Подстановка объявления заявкам, пришедшим раньше синхронизации.
 *
 * Объявление у заявки мы узнаём, сопоставляя номер из метки клика со своей
 * базой объявлений. А база наполняется ночной синхронизацией — значит запуск
 * рекламы утром даёт разрыв: первые заявки приходят раньше, чем мы вообще
 * узнаём о существовании этого объявления, и остаются без креатива.
 *
 * Метка клика при этом сохранена, так что чинится разрыв дешево: после каждой
 * синхронизации проходим по таким заявкам и доставляем недостающее. Иначе
 * первый день любой рекламной кампании навсегда остаётся слепым пятном в
 * отчёте «какой ролик приводит покупателей» — а это как раз тот день, когда
 * решают, оставлять кампанию или выключать.
 *
 * Берём ПЕРВЫЙ клик человека: он объясняет, что тот изначально искал.
 * Последующие клики остаются в истории и идут в CAPI, но креатив не меняют.
 */
export async function backfillClickAttribution(
  supabase: Supabase,
  companyId: string,
): Promise<number> {
  const { data: clicks } = await supabase
    .from('lead_clicks')
    .select('lead_id, ad_external_id, clicked_at')
    .eq('company_id', companyId)
    .not('ad_external_id', 'is', null)
    .order('clicked_at');

  if (!clicks || clicks.length === 0) return 0;

  // Первый клик на человека: запрос уже отсортирован, поэтому побеждает
  // тот, что встретился раньше.
  const firstClick = new Map<string, string>();
  for (const click of clicks) {
    if (!click.ad_external_id) continue;
    if (!firstClick.has(click.lead_id)) firstClick.set(click.lead_id, click.ad_external_id);
  }

  const { data: pending } = await supabase
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .is('creative_id', null)
    .in('id', [...firstClick.keys()]);

  if (!pending || pending.length === 0) return 0;

  const wanted = [...new Set(pending.map((lead) => firstClick.get(lead.id)!))];

  const { data: ads } = await supabase
    .from('ads')
    .select('id, external_id, creative_id, campaign_id')
    .eq('company_id', companyId)
    .in('external_id', wanted);

  if (!ads || ads.length === 0) return 0;

  const adByExternal = new Map(ads.map((ad) => [ad.external_id, ad]));

  let filled = 0;
  for (const lead of pending) {
    const ad = adByExternal.get(firstClick.get(lead.id)!);
    // Объявления всё ещё нет в базе — вернёмся к этой заявке после следующей
    // синхронизации. Ждать оно может сколько угодно: метка клика никуда не
    // денется.
    if (!ad) continue;

    const { error } = await supabase
      .from('leads')
      .update({ ad_id: ad.id, creative_id: ad.creative_id, campaign_id: ad.campaign_id })
      .eq('id', lead.id);

    if (!error) filled += 1;
  }

  return filled;
}

/** Входящее сообщение: находим или заводим клиента и сохраняем текст. */
async function handleMessage(
  supabase: Supabase,
  target: NumberRecord,
  message: InboundMessage,
  profileName: string | null,
): Promise<boolean> {
  const waId = message.from;
  if (!waId) return false;

  const digits = waId.replace(/\D/g, '');
  if (!digits) return false;

  const receivedAt = message.timestamp
    ? new Date(Number(message.timestamp) * 1000)
    : new Date();

  const { lead, isNew, silentSince } = await findOrCreateLead(supabase, target, {
    digits,
    profileName,
    receivedAt,
    hasReferral: Boolean(message.referral?.ctwa_clid),
  });

  await recordReferral(supabase, target, lead, message.referral, receivedAt);

  const { error } = await supabase.from('whatsapp_messages').insert({
    company_id: target.companyId,
    whatsapp_number_id: target.id,
    lead_id: lead.id,
    wa_message_id: message.id ?? null,
    direction: 'in',
    type: message.type ?? 'text',
    body: messageText(message),
    media_id: mediaId(message),
    status: 'received',
    sent_at: receivedAt.toISOString(),
  });

  // Повтор доставки — не ошибка: сообщение уже сохранено раньше.
  if (error && error.code !== '23505') throw new Error(error.message);

  await supabase
    .from('leads')
    .update({ last_inbound_at: receivedAt.toISOString() })
    .eq('id', lead.id);

  // Отметка на номере: по ней в разделе видно, что приём живой, без похода
  // в журнал событий.
  await supabase
    .from('whatsapp_numbers')
    .update({ last_message_at: receivedAt.toISOString(), last_error: null })
    .eq('id', target.id);

  // Автоответ уходит новому клиенту и вернувшемуся после суток тишины:
  // писать его на каждое сообщение внутри живого разговора — навязчиво.
  if (isNew || silentSince) await maybeAutoReply(supabase, target, lead.id, waId);

  return true;
}

type LeadRecord = { id: string; creative_id: string | null; campaign_id: string | null };

/**
 * Клиент по номеру. Один человек на одном номере — один лид, сколько бы раз
 * он ни написал: считаем клиента, а не обращение.
 */
async function findOrCreateLead(
  supabase: Supabase,
  target: NumberRecord,
  input: {
    digits: string;
    profileName: string | null;
    receivedAt: Date;
    hasReferral: boolean;
  },
): Promise<{ lead: LeadRecord; isNew: boolean; silentSince: boolean }> {
  const { data: existing } = await supabase
    .from('leads')
    .select('id, creative_id, campaign_id, last_inbound_at')
    .eq('whatsapp_number_id', target.id)
    .eq('phone_digits', input.digits)
    .maybeSingle();

  if (existing) {
    const last = existing.last_inbound_at ? new Date(existing.last_inbound_at) : null;
    const silentSince =
      last !== null && input.receivedAt.getTime() - last.getTime() > REPLY_WINDOW_MS;
    return { lead: existing, isNew: false, silentSince };
  }

  const { data: created, error } = await supabase
    .from('leads')
    .insert({
      company_id: target.companyId,
      whatsapp_number_id: target.id,
      department_id: target.departmentId,
      name: input.profileName?.trim() || 'Клиент WhatsApp',
      phone: `+${input.digits}`,
      source: 'whatsapp',
      // Площадку ставим только тем, кто действительно пришёл с рекламы Meta.
      // Написавший по визитке рекламным лидом не является.
      platform: input.hasReferral ? 'meta' : null,
      status: 'new',
      last_inbound_at: input.receivedAt.toISOString(),
    })
    .select('id, creative_id, campaign_id')
    .single();

  // Два сообщения подряд от нового человека приходят почти одновременно, и
  // второе может обогнать первое. Проигравший просто читает готовую строку.
  if (error) {
    const { data: raced } = await supabase
      .from('leads')
      .select('id, creative_id, campaign_id')
      .eq('whatsapp_number_id', target.id)
      .eq('phone_digits', input.digits)
      .maybeSingle();

    // Строки нет — значит вставку отклонили не из-за гонки, а по другой
    // причине, и молчать об этом нельзя: сообщение потеряется.
    if (!raced) throw new Error(`не удалось завести клиента: ${error.message}`);

    return { lead: raced, isNew: false, silentSince: false };
  }

  return { lead: created, isNew: true, silentSince: false };
}

/**
 * Рекламный переход.
 *
 * Клик пишем всегда новой строкой, а креатив у лида проставляем только один
 * раз. Разница смысловая: первый клик объясняет, что человек изначально
 * искал, а последний — тот, за который заплачено и который уйдёт в CAPI.
 * Одно поле хранит только одно из двух, и вторая цифра теряется молча.
 */
async function recordReferral(
  supabase: Supabase,
  target: NumberRecord,
  lead: LeadRecord,
  referral: Referral | undefined,
  clickedAt: Date,
): Promise<void> {
  const clid = referral?.ctwa_clid;
  if (!clid) return;

  await supabase.from('lead_clicks').upsert(
    {
      company_id: target.companyId,
      lead_id: lead.id,
      ctwa_clid: clid,
      ad_external_id: referral.source_id ?? null,
      source_type: referral.source_type ?? null,
      clicked_at: clickedAt.toISOString(),
    },
    { onConflict: 'lead_id,ctwa_clid', ignoreDuplicates: true },
  );

  if (lead.creative_id || lead.campaign_id) return;

  const adId = referral.source_id;
  if (!adId || !/^\d{5,25}$/.test(adId)) return;

  const { data: ad } = await supabase
    .from('ads')
    .select('id, creative_id, campaign_id')
    .eq('company_id', target.companyId)
    .eq('external_id', adId)
    .maybeSingle();

  if (!ad) return;

  await supabase
    .from('leads')
    .update({ ad_id: ad.id, creative_id: ad.creative_id, campaign_id: ad.campaign_id })
    .eq('id', lead.id);
}

/**
 * Путь сообщения к клиенту. Двигаться по нему можно только вперёд.
 *
 * Отказ стоит последним не потому, что случается позже, а потому что он
 * важнее любой отметки о доставке: сообщение, которое не дошло, не должно
 * выглядеть отправленным.
 */
const DELIVERY_ORDER = ['received', 'sent', 'delivered', 'read', 'failed'] as const;

/**
 * Отметка о доставке нашего автоответа.
 *
 * Meta присылает эти отметки НЕ по порядку: на живом номере «прочитано»
 * пришло раньше «доставлено», а «отправлено» — последним. Записывать просто
 * последнюю пришедшую нельзя: прочитанное сообщение откатывалось бы обратно
 * в «отправлено», и переписка врала бы о самом простом — дошло или нет.
 *
 * Поэтому обновляем, только если новая отметка дальше текущей по пути.
 * Условие стоит в самом запросе, а не в коде: две отметки приходят с
 * разницей в доли секунды, и проверка «прочитал, сравнил, записал» успела бы
 * разойтись сама с собой.
 */
async function handleStatus(supabase: Supabase, status: StatusUpdate): Promise<void> {
  if (!status.id || !status.status) return;

  const next = DELIVERY_ORDER.indexOf(status.status as (typeof DELIVERY_ORDER)[number]);
  if (next < 0) return;

  const earlier = DELIVERY_ORDER.slice(0, next);
  if (earlier.length === 0) return;

  await supabase
    .from('whatsapp_messages')
    .update({
      status: status.status as 'sent' | 'delivered' | 'read' | 'failed',
      error: status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? null,
    })
    .eq('wa_message_id', status.id)
    .in('status', earlier);
}

/** Текст сообщения — то, что менеджер прочитает в карточке. */
function messageText(message: InboundMessage): string | null {
  if (message.text?.body) return message.text.body;
  if (message.image?.caption) return message.image.caption;
  if (message.video?.caption) return message.video.caption;
  if (message.document?.filename) return message.document.filename;
  // Голосовое и прочее без текста: подпись важнее пустоты — по ней видно,
  // что человек всё-таки написал, просто не буквами.
  return message.type ? `[${message.type}]` : null;
}

function mediaId(message: InboundMessage): string | null {
  return (
    message.image?.id ?? message.audio?.id ?? message.video?.id ?? message.document?.id ?? null
  );
}

/**
 * Автоответ.
 *
 * Днём и ночью текст разный: обещание «ответим в течение минуты» в три часа
 * ночи не удерживает клиента, а расстраивает его дважды.
 */
async function maybeAutoReply(
  supabase: Supabase,
  target: NumberRecord,
  leadId: string,
  waId: string,
): Promise<void> {
  if (!target.autoReplyEnabled || !target.token) return;

  const { data: company } = await supabase
    .from('companies')
    .select('timezone, work_start_time, work_end_time')
    .eq('id', target.companyId)
    .maybeSingle();

  const timeZone = target.timeZone || company?.timezone || DEFAULT_TIME_ZONE;
  const start = target.workStartTime || company?.work_start_time || DEFAULT_DAY_START;
  const end = target.workEndTime || company?.work_end_time || DEFAULT_DAY_END;

  const text = withinWorkingHours(new Date(), timeZone, start, end)
    ? target.autoReplyDay
    : (target.autoReplyNight ?? target.autoReplyDay);

  if (!text?.trim()) return;

  await sendText(supabase, target, leadId, waId, text.trim());
}

/** Рабочее ли сейчас время в поясе номера. */
export function withinWorkingHours(
  now: Date,
  timeZone: string,
  start: string,
  end: string,
): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  const current = minutesOfDay(parts);
  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  if (current === null || from === null || to === null) return true;

  // Смена через полночь: «с 21:00 до 09:00» — это две части суток, а не пустой
  // промежуток.
  return from <= to ? current >= from && current < to : current >= from || current < to;
}

/**
 * Отправка текста клиенту.
 *
 * Отсюда уходит и автоответ, и то, что менеджер написал руками в разделе
 * «Переписки». Номер, подключённый к Cloud API, в приложении WhatsApp не
 * открывается вовсе, поэтому другого способа ответить человеку нет.
 *
 * Запись в журнал делается всегда — и при успехе, и при отказе Meta. Иначе
 * менеджер видит своё сообщение в переписке и считает, что оно доставлено,
 * хотя Meta его не приняла.
 */
export async function sendText(
  supabase: Supabase,
  target: NumberRecord,
  leadId: string,
  waId: string,
  text: string,
): Promise<void> {
  let waMessageId: string | null = null;
  let status: 'sent' | 'failed' = 'sent';
  let error: string | null = null;

  try {
    const response = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${target.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${target.token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: waId,
          type: 'text',
          text: { body: text },
        }),
        cache: 'no-store',
      },
    );

    const payload = (await response.json()) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };

    if (payload.error) {
      status = 'failed';
      error = payload.error.message ?? 'Meta отклонила отправку';
    } else {
      waMessageId = payload.messages?.[0]?.id ?? null;
    }
  } catch (cause) {
    status = 'failed';
    error = cause instanceof Error ? cause.message : 'не удалось отправить';
  }

  await supabase.from('whatsapp_messages').insert({
    company_id: target.companyId,
    whatsapp_number_id: target.id,
    lead_id: leadId,
    wa_message_id: waMessageId,
    direction: 'out',
    type: 'text',
    body: text,
    status,
    error,
  });
}
