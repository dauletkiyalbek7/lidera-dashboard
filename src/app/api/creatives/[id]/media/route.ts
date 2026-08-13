import { NextResponse } from 'next/server';

import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Видео креатива.
 *
 * Ссылки Meta подписаны и живут недолго, поэтому храним не адрес, а
 * идентификатор ролика: сервер получает свежий адрес и отправляет туда
 * браузер. Токен при этом не покидает сервер — в ответе только ссылка на
 * CDN, которая уже никого не пускает в рекламный кабинет.
 *
 * Клиент ходит сюда под своей сессией, и креатив читается через RLS: чужой
 * ролик отдать невозможно, даже зная его id.
 */

export const dynamic = 'force-dynamic';

const API_VERSION = process.env.META_API_VERSION || 'v23.0';

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

  const { data: creative } = await supabase
    .from('creatives')
    .select('id, video_id')
    .eq('id', id)
    .maybeSingle();

  if (!creative?.video_id) {
    return NextResponse.json({ error: 'у креатива нет видео' }, { status: 404 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'токен Meta не задан' }, { status: 503 });
  }

  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${creative.video_id}` +
      `?fields=source&access_token=${token}`,
    { cache: 'no-store' },
  );

  const payload = (await response.json()) as {
    source?: string;
    error?: { message: string };
  };

  if (!payload.source) {
    return NextResponse.json(
      { error: payload.error?.message ?? 'Meta не отдала видео' },
      { status: 502 },
    );
  }

  // Короткий кеш: ссылка всё равно временная, а перемотка не должна каждый
  // раз ходить в Meta.
  return NextResponse.redirect(payload.source, {
    status: 302,
    headers: { 'Cache-Control': 'private, max-age=600' },
  });
}
