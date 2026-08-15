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
 * Личные данные покупателя уходят только хешем (SHA-256), как того требует
 * Meta: сравнить со своей базой она может, прочитать телефон — нет.
 */

const API_VERSION = process.env.META_API_VERSION || 'v23.0';

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

/**
 * Отправка покупки. Возвращает результат, но не бросает исключений: продажа в
 * кабинете важнее, чем ответ рекламной площадки, и падать из-за неё нельзя.
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

  // Один идентификатор на продажу: повторная отметка не создаст вторую покупку
  // в отчётах Meta, а событие с сайта склеится с нашим по тому же event_id.
  const eventId = `sale.${event.saleId}`;

  const { data: already } = await supabase
    .from('capi_events')
    .select('id')
    .eq('company_id', companyId)
    .eq('event_id', eventId)
    .eq('status', 'sent')
    .maybeSingle();

  if (already) return { ok: true, eventId };

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

  let status: 'sent' | 'failed' = 'sent';
  let response = '';

  try {
    const result = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${settings.dataset_id}/events` +
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

    if (payload.error) {
      status = 'failed';
      response = payload.error.message;
    } else {
      response = `принято событий: ${payload.events_received ?? 0}`;
    }
  } catch (error) {
    status = 'failed';
    response = error instanceof Error ? error.message : 'сеть недоступна';
  }

  // Проверочные события идут без продажи: у них выдуманный номер, и ссылку на
  // несуществующую строку база справедливо не принимает.
  const isRealSale =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.saleId);

  await supabase.from('capi_events').insert({
    company_id: companyId,
    sale_id: isRealSale ? event.saleId : null,
    event_name: 'Purchase',
    event_id: eventId,
    value: event.value,
    currency: event.currency,
    status,
    response,
  });

  await supabase
    .from('capi_settings')
    .update({
      last_event_at: new Date().toISOString(),
      last_error: status === 'failed' ? response : null,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId);

  return status === 'sent' ? { ok: true, eventId } : { ok: false, error: response };
}

/**
 * Отправка покупки по продаже из базы: собирает данные покупателя и метки
 * клика из заявки, к которой продажа привязана.
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

  let lead: { name: string; phone: string | null; email: string | null; fbc: string | null; fbp: string | null } | null =
    null;

  if (sale.lead_id) {
    const { data } = await supabase
      .from('leads')
      .select('name, phone, email, fbc, fbp')
      .eq('id', sale.lead_id)
      .maybeSingle();
    lead = data ?? null;
  }

  return sendPurchase(companyId, {
    saleId: sale.id,
    value: Number(sale.amount),
    currency: company?.sales_currency ?? 'KZT',
    eventTime: new Date(sale.sale_date),
    phone: lead?.phone ?? null,
    email: lead?.email ?? null,
    name: lead?.name ?? null,
    fbc: lead?.fbc ?? null,
    fbp: lead?.fbp ?? null,
  });
}
