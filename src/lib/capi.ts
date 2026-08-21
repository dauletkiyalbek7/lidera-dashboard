import 'server-only';

import { createHash } from 'node:crypto';

import { decryptSecret } from '@/lib/secrets';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Conversions API: покупки уходят в Meta с сервера.
 *
 * Пиксель видит только сайт, а курс оплачивают позже — переводом, в рассрочку,
 * после разговора. Об этом Meta может узнать только от нас, поэтому событие
 * отправляет платформа.
 *
 * Дорог до Meta две, и перепутать их нельзя.
 *
 *   • Сайт. Человека узнают по хешу телефона и меткам пикселя (fbc/fbp),
 *     событие идёт в набор данных компании.
 *   • Переписка с рекламы. Здесь ни пикселя, ни куки нет вовсе: клиент нажал
 *     «Написать» в объявлении и оказался в WhatsApp. Единственная ниточка к
 *     объявлению — метка клика ctwa_clid, которую Meta прислала вместе с
 *     первым сообщением. Событие идёт в набор данных, привязанный к самому
 *     аккаунту WhatsApp, и в другой форме — action_source business_messaging.
 *
 * Личные данные покупателя уходят только хешем (SHA-256), как того требует
 * Meta: сравнить со своей базой она может, прочитать телефон — нет.
 */

const API_VERSION = process.env.META_API_VERSION || 'v23.0';

/** Meta привязывает покупку к объявлению, если та случилась в этот срок. */
const ATTRIBUTION_DAYS = 7;

export type PurchaseEvent = {
  saleId: string;
  value: number;
  currency: string;
  /** Время продажи; Meta принимает события не старше семи дней. */
  eventTime: Date;
  phone: string | null;
  email: string | null;
  name: string | null;
  /** Метки клика по объявлению из заявки — с ними атрибуция точная. */
  fbc: string | null;
  fbp: string | null;
};

export type CapiResult = { ok: true; eventId: string } | { ok: false; error: string };

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Телефон Meta ждёт в виде цифр с кодом страны, без плюса и пробелов. */
function normalizePhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  // Казахстанские номера часто пишут через 8 — приводим к 7.
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits;
}

/** Один идентификатор на продажу: повторная отправка не задвоит покупку. */
function eventIdOf(saleId: string): string {
  return `sale.${saleId}`;
}

/**
 * Проверочные события идут без продажи: у них выдуманный номер, и ссылку на
 * несуществующую строку база справедливо не принимает.
 */
function isRealSale(saleId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleId);
}

/**
 * Отправка покупки с сайта. Возвращает результат, но не бросает исключений:
 * продажа в кабинете важнее, чем ответ рекламной площадки, и падать из-за неё
 * нельзя.
 */
export async function sendPurchase(
  companyId: string,
  event: PurchaseEvent,
): Promise<CapiResult> {
  const supabase = createAdminSupabase();

  const { data: settings } = await supabase
    .from('capi_settings')
    .select('dataset_id, token_encrypted, test_event_code, enabled')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!settings || !settings.enabled) {
    return { ok: false, error: 'CAPI для компании не настроен' };
  }

  const eventId = eventIdOf(event.saleId);
  if (await alreadySent(companyId, eventId)) return { ok: true, eventId };

  const phone = event.phone ? normalizePhone(event.phone) : null;
  const email = event.email?.trim().toLowerCase() || null;
  const firstName = event.name?.trim().split(/\s+/)[0]?.toLowerCase() || null;

  const userData: Record<string, string[] | string> = {};
  if (phone) userData.ph = [hash(phone)];
  if (email) userData.em = [hash(email)];
  if (firstName) userData.fn = [hash(firstName)];
  if (event.fbc) userData.fbc = event.fbc;
  if (event.fbp) userData.fbp = event.fbp;

  // Без единого совпадения Meta не с кем сопоставить покупку.
  if (Object.keys(userData).length === 0) {
    return { ok: false, error: 'у продажи нет ни телефона, ни почты, ни метки клика' };
  }

  let token: string;
  try {
    token = decryptSecret(settings.token_encrypted);
  } catch {
    return { ok: false, error: 'токен не читается — введите его заново' };
  }

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(event.eventTime.getTime() / 1000),
        event_id: eventId,
        action_source: 'system_generated',
        user_data: userData,
        custom_data: { value: event.value, currency: event.currency },
      },
    ],
  };
  if (settings.test_event_code) body.test_event_code = settings.test_event_code;

  const delivery = await post(settings.dataset_id, token, body);

  return finish(companyId, {
    saleId: event.saleId,
    eventId,
    value: event.value,
    currency: event.currency,
    delivery,
  });
}

/**
 * Отправка покупки из переписки, начатой с рекламы.
 *
 * Здесь Meta узнаёт клиента не по телефону, а по метке клика: телефон в
 * WhatsApp может быть чужой, а метка выдана самой Meta ровно тому человеку,
 * который нажал кнопку в объявлении. Телефон всё равно прикладываем — лишний
 * признак совпадения не мешает, а метка могла протухнуть.
 */
export type MessagingPurchase = {
  saleId: string;
  value: number;
  currency: string;
  eventTime: Date;
  phone: string | null;
  datasetId: string;
  tokenEncrypted: string;
  wabaId: string;
  ctwaClid: string;
  /** Когда человек нажал на объявление — от этого считается срок привязки. */
  clickedAt: Date;
};

export async function sendMessagingPurchase(
  companyId: string,
  event: MessagingPurchase,
): Promise<CapiResult> {
  const eventId = eventIdOf(event.saleId);
  if (await alreadySent(companyId, eventId)) return { ok: true, eventId };

  let token: string;
  try {
    token = decryptSecret(event.tokenEncrypted);
  } catch {
    return { ok: false, error: 'токен номера не читается — введите его заново' };
  }

  const phone = event.phone ? normalizePhone(event.phone) : null;

  const userData: Record<string, string[] | string> = {
    whatsapp_business_account_id: event.wabaId,
    ctwa_clid: event.ctwaClid,
  };
  if (phone) userData.ph = [hash(phone)];

  const body = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(event.eventTime.getTime() / 1000),
        event_id: eventId,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: userData,
        custom_data: { value: event.value, currency: event.currency },
      },
    ],
  };

  const delivery = await post(event.datasetId, token, body);

  // Опоздание не ошибка: событие принято и в отчётах будет. Но к объявлению
  // Meta его уже не привяжет, и таргетолог должен видеть, почему конверсия не
  // появилась там, где он её ждёт.
  const lateBy = Math.floor(
    (event.eventTime.getTime() - event.clickedAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  const note =
    delivery.ok && lateBy >= ATTRIBUTION_DAYS
      ? `; клик был ${lateBy} дн. назад — к объявлению Meta не привяжет`
      : '';

  return finish(companyId, {
    saleId: event.saleId,
    eventId,
    value: event.value,
    currency: event.currency,
    delivery: { ...delivery, message: delivery.message + note },
  });
}

// -----------------------------------------------------------------------------
// Общее для обеих дорог
// -----------------------------------------------------------------------------

type Delivery = { ok: boolean; message: string };

/** Уже принятое событие второй раз не шлём: покупка задвоится в отчётах. */
async function alreadySent(companyId: string, eventId: string): Promise<boolean> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('capi_events')
    .select('id')
    .eq('company_id', companyId)
    .eq('event_id', eventId)
    .eq('status', 'sent')
    .maybeSingle();

  return Boolean(data);
}

async function post(
  datasetId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Delivery> {
  try {
    const result = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${datasetId}/events` +
        `?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    );

    const payload = (await result.json()) as {
      events_received?: number;
      error?: { message: string };
    };

    if (payload.error) return { ok: false, message: payload.error.message };
    return { ok: true, message: `принято событий: ${payload.events_received ?? 0}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'сеть недоступна' };
  }
}

/** Запись в журнал и ответ вызывающему — одинаково для сайта и переписки. */
async function finish(
  companyId: string,
  input: {
    saleId: string;
    eventId: string;
    value: number;
    currency: string;
    delivery: Delivery;
  },
): Promise<CapiResult> {
  const supabase = createAdminSupabase();
  const status = input.delivery.ok ? 'sent' : 'failed';

  await supabase.from('capi_events').insert({
    company_id: companyId,
    sale_id: isRealSale(input.saleId) ? input.saleId : null,
    event_name: 'Purchase',
    event_id: input.eventId,
    value: input.value,
    currency: input.currency,
    status,
    response: input.delivery.message,
  });

  // Строки настроек может не быть вовсе: у переписок свой набор данных, и
  // компания могла ни разу не открывать настройки CAPI. Тогда это пустая
  // правка, а не ошибка.
  await supabase
    .from('capi_settings')
    .update({
      last_event_at: new Date().toISOString(),
      last_error: status === 'failed' ? input.delivery.message : null,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId);

  return status === 'sent'
    ? { ok: true, eventId: input.eventId }
    : { ok: false, error: input.delivery.message };
}

/**
 * Отправка покупки по продаже из базы.
 *
 * Дорогу выбирает происхождение клиента: пришёл из рекламы в WhatsApp —
 * значит событие идёт как сообщение, с меткой клика. Всё остальное — как
 * покупка с сайта.
 */
export async function sendPurchaseForSale(
  companyId: string,
  saleId: string,
): Promise<CapiResult> {
  const supabase = createAdminSupabase();

  const { data: sale } = await supabase
    .from('sales')
    .select('id, amount, sale_date, status, lead_id')
    .eq('company_id', companyId)
    .eq('id', saleId)
    .maybeSingle();

  if (!sale || sale.status !== 'paid') {
    return { ok: false, error: 'продажа не оплачена' };
  }

  const { data: company } = await supabase
    .from('companies')
    .select('sales_currency')
    .eq('id', companyId)
    .maybeSingle();

  const currency = company?.sales_currency ?? 'KZT';
  const eventTime = new Date(sale.sale_date);

  let lead: {
    name: string;
    phone: string | null;
    email: string | null;
    fbc: string | null;
    fbp: string | null;
    whatsapp_number_id: string | null;
  } | null = null;

  if (sale.lead_id) {
    const { data } = await supabase
      .from('leads')
      .select('name, phone, email, fbc, fbp, whatsapp_number_id')
      .eq('id', sale.lead_id)
      .maybeSingle();
    lead = data ?? null;
  }

  const messaging =
    sale.lead_id && lead?.whatsapp_number_id
      ? await messagingRoute(companyId, sale.lead_id, lead.whatsapp_number_id)
      : null;

  if (messaging) {
    return sendMessagingPurchase(companyId, {
      saleId: sale.id,
      value: Number(sale.amount),
      currency,
      eventTime,
      phone: lead?.phone ?? null,
      ...messaging,
    });
  }

  return sendPurchase(companyId, {
    saleId: sale.id,
    value: Number(sale.amount),
    currency,
    eventTime,
    phone: lead?.phone ?? null,
    email: lead?.email ?? null,
    name: lead?.name ?? null,
    fbc: lead?.fbc ?? null,
    fbp: lead?.fbp ?? null,
  });
}

/**
 * Всё ли есть, чтобы отправить покупку как сообщение.
 *
 * Нужны три вещи разом: метка клика (иначе объявление неизвестно), набор
 * данных переписок и токен номера. Не хватает хотя бы одной — возвращаем
 * null, и продажа уходит обычной дорогой: событие без привязки лучше, чем
 * никакого.
 */
async function messagingRoute(
  companyId: string,
  leadId: string,
  numberId: string,
): Promise<{
  datasetId: string;
  tokenEncrypted: string;
  wabaId: string;
  ctwaClid: string;
  clickedAt: Date;
} | null> {
  const supabase = createAdminSupabase();

  const [{ data: number }, { data: click }] = await Promise.all([
    supabase
      .from('whatsapp_numbers')
      .select('dataset_id, waba_id, token_encrypted')
      .eq('id', numberId)
      .eq('company_id', companyId)
      .maybeSingle(),
    // Кликов может быть несколько: человек возвращался по разным объявлениям.
    // Считаем последний — он и привёл к покупке.
    supabase
      .from('lead_clicks')
      .select('ctwa_clid, clicked_at')
      .eq('company_id', companyId)
      .eq('lead_id', leadId)
      .order('clicked_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!number?.dataset_id || !number.waba_id || !number.token_encrypted) return null;
  if (!click?.ctwa_clid) return null;

  return {
    datasetId: number.dataset_id,
    tokenEncrypted: number.token_encrypted,
    wabaId: number.waba_id,
    ctwaClid: click.ctwa_clid,
    clickedAt: new Date(click.clicked_at),
  };
}
