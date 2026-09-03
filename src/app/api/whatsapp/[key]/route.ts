import { NextResponse } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  numberByWebhookKey,
  processWebhook,
  signatureValid,
  type WebhookBody,
} from '@/lib/whatsapp';

/**
 * Вебхук WhatsApp Cloud API.
 *
 * Адрес вида /api/whatsapp/<ключ номера>. Ключ нужен именно в адресе: подпись
 * Meta надо проверить до разбора тела, то есть до того, как мы узнаем, о каком
 * номере речь. Ключ сразу говорит, чьим секретом проверять.
 *
 * Кому событие адресовано на самом деле, решает phone_number_id из тела: в
 * одном приложении Meta живут номера разных проектов, а адрес вебхука у него
 * один. Поэтому тело и подпись уходят дальше — чужой номер принимается только
 * под свою подпись.
 *
 * Meta ждёт от вебхука 200 в любом случае. Если отвечать ошибкой, она начинает
 * повторять доставку и заваливает повторами — поэтому здесь 200 отдаётся даже
 * когда разбор упал. Что именно случилось, видно в whatsapp_events.
 */

export const dynamic = 'force-dynamic';

/** Подключение вебхука: Meta присылает загадку и ждёт её обратно. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const url = new URL(request.url);

  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode !== 'subscribe' || !token || !challenge) {
    return NextResponse.json({ error: 'неверный запрос' }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const number = await numberByWebhookKey(supabase, key);

  if (!number || number.verifyToken !== token) {
    return NextResponse.json({ error: 'неверный ключ' }, { status: 403 });
  }

  // Отмечаем сам факт подключения. Без этой записи при разборе «почему нет
  // сообщений» нельзя отличить «Meta до нас не дошла» от «дошла, но забыли
  // подписаться на поле messages» — а это разные починки.
  await supabase.from('whatsapp_events').insert({
    whatsapp_number_id: number.id,
    kind: 'other',
    payload: { event: 'webhook_verified' },
    signature_ok: true,
    processed_at: new Date().toISOString(),
  });

  // Ответ обязан быть голым текстом загадки — JSON Meta не принимает.
  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  // Тело читаем строкой и в таком виде и проверяем: подпись считается по
  // сырым байтам, любая пересборка JSON её ломает.
  const rawBody = await request.text();
  const supabase = createAdminSupabase();

  const number = await numberByWebhookKey(supabase, key);
  if (!number) {
    // Чужой ключ не логируем в события: у записи нет номера, а складывать
    // чужой мусор в таблицу — способ её переполнить.
    return NextResponse.json({ ok: true });
  }

  const signatureOk =
    number.appSecret !== null &&
    signatureValid(rawBody, request.headers.get('x-hub-signature-256'), number.appSecret);

  let body: WebhookBody | null = null;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    body = null;
  }

  // Сырое тело сохраняем до разбора и независимо от того, сойдётся подпись
  // или нет: неподписанные попытки — это и есть то, ради чего проверка нужна,
  // и видеть их надо.
  await logEvent(supabase, number.id, body, rawBody, signatureOk);

  if (!signatureOk || !body) return NextResponse.json({ ok: true });

  try {
    await processWebhook(supabase, number, body, {
      rawBody,
      signature: request.headers.get('x-hub-signature-256'),
    });
  } catch {
    // Разбор упал — событие уже сохранено, можно переиграть позже.
  }

  return NextResponse.json({ ok: true });
}

/**
 * Запись сырого события.
 *
 * Уникальность по идентификатору сообщения заодно защищает от повторной
 * доставки: Meta повторяет охотно, а второй такой же строки не будет.
 */
async function logEvent(
  supabase: ReturnType<typeof createAdminSupabase>,
  numberId: string,
  body: WebhookBody | null,
  rawBody: string,
  signatureOk: boolean,
): Promise<void> {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const messageId = value?.messages?.[0]?.id ?? null;
  const kind = value?.messages?.length
    ? 'message'
    : value?.statuses?.length
      ? 'status'
      : 'other';

  try {
    await supabase.from('whatsapp_events').insert({
      whatsapp_number_id: numberId,
      wa_message_id: messageId,
      kind,
      // Тело не разобралось — сохраняем как строку, чтобы было что смотреть.
      payload: body ?? { unparsed: rawBody.slice(0, 20_000) },
      signature_ok: signatureOk,
      processed_at: new Date().toISOString(),
    });
  } catch {
    // Журнал не должен ронять приём: сообщение важнее записи о нём.
  }
}
