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

  if (!company) return NextResponse.json({ error: 'неверный ключ' }, { status: 404 });
  if (company.status === 'inactive') {
    return NextResponse.json({ error: 'компания отключена' }, { status: 403 });
  }

  const name = pick(payload, NAME_KEYS) ?? '';
  const phone = pick(payload, PHONE_KEYS) ?? null;
  const email = pick(payload, EMAIL_KEYS) ?? null;

  // Заявка без единого контакта бесполезна: звонить и писать некуда.
  if (!phone && !email) {
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

  const { error } = await supabase.from('leads').insert({
    company_id: company.id,
    name: name || 'Заявка с сайта',
    phone,
    email,
    source: 'site',
    platform: fbc ? 'meta' : null,
    // Объявление подставляем, если в utm_content стоит его номер: в Meta это
    // подстановка {{ad.id}}. Не нашли — лид всё равно сохраняем.
    creative_id: await creativeByAdId(supabase, company.id, utmContent),
    utm_source: pick(payload, ['utm_source']) ?? null,
    utm_medium: pick(payload, ['utm_medium']) ?? null,
    utm_campaign: pick(payload, ['utm_campaign']) ?? null,
    utm_content: utmContent,
    utm_term: pick(payload, ['utm_term']) ?? null,
    fbc,
    fbp: pick(payload, ['fbp', '_fbp']) ?? null,
    external_id: pick(payload, ['tranid', 'transaction_id', 'external_id']) ?? null,
    status: 'new',
  });

  if (error) {
    // Повтор той же отправки — не ошибка: вебхук мог прийти дважды.
    if (error.code === '23505') return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: 'не удалось сохранить заявку' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
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

async function creativeByAdId(
  supabase: ReturnType<typeof createAdminSupabase>,
  companyId: string,
  adId: string | null,
): Promise<string | null> {
  if (!adId || !/^\d{5,25}$/.test(adId)) return null;

  const { data } = await supabase
    .from('ads')
    .select('creative_id')
    .eq('company_id', companyId)
    .eq('external_id', adId)
    .maybeSingle();

  return data?.creative_id ?? null;
}
