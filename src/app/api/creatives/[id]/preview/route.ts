import { NextResponse } from 'next/server';

import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Предпросмотр объявления — запасной путь, когда ролик напрямую не отдают.
 *
 * Видео, загруженное в рекламный кабинет, Meta отдаёт файлом. А если реклама
 * сделана из поста страницы или Instagram, ролик принадлежит странице, и к
 * нему у платформы доступа нет: кабинет выдали, страницу — нет. Зато у любого
 * объявления есть предпросмотр — рамка, в которой Meta сама показывает его
 * таким, каким его видит человек в ленте. Для неё хватает доступа к кабинету.
 *
 * Отдаём только адрес рамки. Он одноразовый и недолгий, токен в нём не
 * участвует — как и у ролика, наружу уходит только ссылка на сторону Meta.
 *
 * Креатив и его объявление читаются под сессией клиента, через RLS: чужое
 * объявление показать нельзя, даже зная id.
 */

export const dynamic = 'force-dynamic';

const API_VERSION = process.env.META_API_VERSION || 'v23.0';

/** Вид ленты Instagram: вертикальный, как сняты почти все ролики. */
const AD_FORMAT = 'INSTAGRAM_STANDARD';

/** Рамку принимаем только с адресов самой Meta. */
const TRUSTED_FRAME = /^https:\/\/(business|www)\.facebook\.com\//;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'нужен вход' }, { status: 401 });

  const { data: ads } = await supabase
    .from('ads')
    .select('external_id')
    .eq('creative_id', id)
    .not('external_id', 'is', null)
    .limit(1);

  const adId = ads?.[0]?.external_id;
  if (!adId) {
    return NextResponse.json({ error: 'у креатива нет объявления' }, { status: 404 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'токен Meta не задан' }, { status: 503 });
  }

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${adId}/previews` +
      `?ad_format=${AD_FORMAT}&access_token=${token}`,
    { cache: 'no-store' },
  );

  const payload = (await response.json()) as {
    data?: { body?: string }[];
    error?: { message: string };
  };

  // Meta присылает готовый тег <iframe>; из него нужны адрес и размеры.
  const body = payload.data?.[0]?.body ?? '';
  const src = body.match(/src="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');

  if (!src || !TRUSTED_FRAME.test(src)) {
    return NextResponse.json(
      { error: payload.error?.message ?? 'Meta не отдала предпросмотр' },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      src,
      width: Number(body.match(/width="(\d+)"/)?.[1] ?? 320),
      height: Number(body.match(/height="(\d+)"/)?.[1] ?? 525),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
