import { NextResponse } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Приём заявок с сайта (Tilda и любые формы с вебхуком).
 *
 * Адрес вида /api/forms/<ключ компании>. Ключ живёт в адресе, потому что
 * конструкторы форм не умеют слать заголовки; права он даёт ровно одно —
 * создать лид. Прочитать им ничего нельзя.
 *
 * Вместе с именем и телефоном забираем метки рекламы: `fbclid` из адреса
 * лендинга и `_fbp` из куки пикселя. Без них платформа сможет сказать Meta
 * «была покупка», но не «купил тот, кто пришёл с этого объявления».
 */

export const dynamic = 'force-dynamic';

/** Поля формы называют по-разному — принимаем распространённые варианты. */
const NAME_KEYS = ['name', 'имя', 'fio', 'фио', 'fullname', 'full_name', 'client_name'];
const PHONE_KEYS = ['phone', 'телефон', 'tel', 'phone_number', 'номер'];
const EMAIL_KEYS = ['email', 'почта', 'e-mail', 'mail'];

/** Служебные поля Tilda: числа в них за телефон принимать нельзя. */
const SERVICE_KEYS = [
  'formid',
  'formname',
  'tranid',
  'transaction_id',
  'external_id',
  'test',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'fbc',
  'fbp',
  '_fbc',
  '_fbp',
  'referer',
  'referrer',
  'cookies',
];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const payload = await readBody(request);

  // Tilda при сохранении вебхука шлёт проверочный запрос: на него нужно
  // ответить успехом, иначе она не даст подключить форму.
  if (payload.test !== undefined && Object.keys(payload).length <= 2) {
    return NextResponse.json({ ok: true });
  }

  if (!/^[0-9a-f]{16,64}$/i.test(key)) {
    return NextResponse.json({ error: 'неверный ключ' }, { status: 404 });
  }

  const supabase = createAdminSupabase();
  const { data: company } = await supabase
    .from('companies')
    .select('id, status')
    .eq('lead_webhook_key', key)
    .maybeSingle();

  // Заявку по чужому ключу тоже записываем, без компании: так видно, что
  // какая-то форма стучится не туда, а не просто «лидов нет».
  if (!company) {
    await logSubmission(supabase, null, payload, {
      status: 'rejected',
      reason: 'вебхук вызван с неизвестным ключом',
    });
    return NextResponse.json({ error: 'неверный ключ' }, { status: 404 });
  }

  if (company.status === 'inactive') {
    await logSubmission(supabase, company.id, payload, {
      status: 'rejected',
      reason: 'компания отключена',
    });
    return NextResponse.json({ error: 'компания отключена' }, { status: 403 });
  }

  const name = pick(payload, NAME_KEYS) ?? '';
  // Поле телефона на разных лендингах называют по-разному — «Ваш телефон»,
  // «Номер WhatsApp». Не нашли по названию — ищем по виду значения: заявка с
  // живым номером не должна пропадать из-за подписи поля.
  const phone = pick(payload, PHONE_KEYS) ?? guessPhone(payload);
  const email = pick(payload, EMAIL_KEYS) ?? null;

  // Заявка без единого контакта бесполезна: звонить и писать некуда. Но в
  // журнал она попадает — иначе о ней никто никогда не узнает.
  if (!phone && !email) {
    await logSubmission(supabase, company.id, payload, {
      status: 'rejected',
      reason: 'не нашли ни телефона, ни почты',
    });
    return NextResponse.json(
      { error: 'в заявке нет ни телефона, ни почты' },
      { status: 422 },
    );
  }

  const fbclid = pick(payload, ['fbclid']);
  const fbc =
    pick(payload, ['fbc', '_fbc']) ??
    (fbclid ? `fb.1.${Date.now()}.${fbclid}` : null);

  const utmContent = pick(payload, ['utm_content']) ?? null;

  // Объявление знает и свой креатив, и свою кампанию — заявка попадёт в оба
  // отчёта сразу.
  const placement = await adPlacement(supabase, company.id, utmContent);

  const { data: created, error } = await supabase.from('leads').insert({
    company_id: company.id,
    campaign_id: placement.campaignId,
    name: name || 'Заявка с сайта',
    phone,
    email,
    source: 'site',
    platform: fbc ? 'meta' : null,
    // Объявление подставляем, если в utm_content стоит его номер: в Meta это
    // подстановка {{ad.id}}. Не нашли — лид всё равно сохраняем.
    creative_id: placement.creativeId,
    utm_source: pick(payload, ['utm_source']) ?? null,
    utm_medium: pick(payload, ['utm_medium']) ?? null,
    utm_campaign: pick(payload, ['utm_campaign']) ?? null,
    utm_content: utmContent,
    utm_term: pick(payload, ['utm_term']) ?? null,
    fbc,
    fbp: pick(payload, ['fbp', '_fbp']) ?? null,
    external_id: pick(payload, ['tranid', 'transaction_id', 'external_id']) ?? null,
    status: 'new',
  })
    .select('id')
    .maybeSingle();

  if (error) {
    // Повтор той же отправки — не ошибка: вебхук мог прийти дважды.
    const duplicate = error.code === '23505';
    await logSubmission(supabase, company.id, payload, {
      status: duplicate ? 'duplicate' : 'error',
      reason: duplicate ? 'такая заявка уже сохранена' : error.message,
    });

    if (duplicate) return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: 'не удалось сохранить заявку' }, { status: 500 });
  }

  await logSubmission(supabase, company.id, payload, {
    status: 'saved',
    leadId: created?.id ?? null,
  });

  return NextResponse.json({ ok: true });
}

/**
 * Запись о вызове вебхука. Пишем всегда, чем бы он ни кончился: сверять
 * список заявок в Tilda с нашим вручную — не работа для человека.
 *
 * Журнал не должен ронять приём: если запись не удалась, заявка всё равно
 * сохранена, и терять её из-за отчётности нельзя.
 */
async function logSubmission(
  supabase: ReturnType<typeof createAdminSupabase>,
  companyId: string | null,
  payload: Record<string, string>,
  outcome: {
    status: 'saved' | 'duplicate' | 'rejected' | 'error';
    reason?: string;
    leadId?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from('form_submissions').insert({
      company_id: companyId,
      lead_id: outcome.leadId ?? null,
      status: outcome.status,
      reason: outcome.reason ?? null,
      payload,
    });
  } catch {
    // Молча: заявка важнее записи о ней.
  }
}

/**
 * Похоже ли значение на телефон.
 *
 * Считаем цифры: казахстанский номер это 10–11 цифр, и разделители бывают
 * любые. Служебные поля Tilda пропускаем — в них тоже лежат длинные числа,
 * и без этого номером клиента стал бы идентификатор формы.
 */
function guessPhone(payload: Record<string, string>): string | null {
  for (const [field, value] of Object.entries(payload)) {
    if (SERVICE_KEYS.includes(field.trim().toLowerCase())) continue;
    if (!value?.trim()) continue;

    const digits = value.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) continue;
    // В строке не должно быть ничего, кроме номера и его оформления.
    if (!/^[\d\s+()\-.]+$/.test(value.trim())) continue;

    return value.trim();
  }
  return null;
}

/** Tilda шлёт форму как urlencoded, свои сайты — чаще JSON. Принимаем оба. */
async function readBody(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? '';

  try {
    if (type.includes('application/json')) {
      const json = (await request.json()) as Record<string, unknown>;
      return flatten(json);
    }
    const form = await request.formData();
    const entries: Record<string, string> = {};
    for (const [field, value] of form.entries()) {
      if (typeof value === 'string') entries[field] = value;
    }
    return entries;
  } catch {
    return {};
  }
}

function flatten(json: Record<string, unknown>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [field, value] of Object.entries(json)) {
    if (value === null || value === undefined) continue;
    flat[field] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return flat;
}

/** Первое непустое значение среди возможных названий поля, без учёта регистра. */
function pick(payload: Record<string, string>, keys: string[]): string | null {
  for (const [field, value] of Object.entries(payload)) {
    if (!value?.trim()) continue;
    if (keys.includes(field.trim().toLowerCase())) return value.trim();
  }
  return null;
}

async function adPlacement(
  supabase: ReturnType<typeof createAdminSupabase>,
  companyId: string,
  adId: string | null,
): Promise<{ creativeId: string | null; campaignId: string | null }> {
  if (!adId || !/^\d{5,25}$/.test(adId)) return { creativeId: null, campaignId: null };

  const { data } = await supabase
    .from('ads')
    .select('creative_id, campaign_id')
    .eq('company_id', companyId)
    .eq('external_id', adId)
    .maybeSingle();

  return { creativeId: data?.creative_id ?? null, campaignId: data?.campaign_id ?? null };
}
