import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isMetaConfigured, syncAllMetaAccounts } from '@/lib/meta-sync';

/**
 * Синхронизация с Meta Ads: каждые два часа, глубокая — раз в сутки.
 *
 * Кабинет уточняет вчерашние цифры ещё пару дней, поэтому раз в сутки окно
 * перезабирается целиком, все тридцать дней. Но делать это каждые два часа
 * незачем: свежим обязан быть сегодняшний расход, а он умещается в три дня —
 * и стоит семь обращений к Meta вместо двадцати двух. Лимит обращений у
 * приложения общий на все проекты, и беречь его приходится всерьёз.
 *
 * Ночной запуск узнаём по часу: планировщик ходит в :25 каждого чётного часа
 * по Гринвичу, и первый после полуночи — тот самый, когда рекламные сутки уже
 * закрыты у всех кабинетов.
 *
 * Доступ закрыт тем же общим секретом, что и раздача лидов: sha256 от
 * сервисного ключа Supabase. Отдельной переменной для крона не нужно.
 */

/** Сколько дней перезабираем между глубокими запусками. */
const LIGHT_WINDOW_DAYS = 3;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    console.error('cron/meta-sync: не задан SUPABASE_SERVICE_ROLE_KEY');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }

  const expected = createHash('sha256').update(serviceKey).digest('hex');

  if (request.headers.get('x-cron-key') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isMetaConfigured()) {
    return NextResponse.json(
      { error: 'META_ACCESS_TOKEN не задан — синхронизация выключена' },
      { status: 503 },
    );
  }

  const deep = new Date().getUTCHours() === 0;
  const result = await syncAllMetaAccounts(
    deep ? undefined : { windowDays: LIGHT_WINDOW_DAYS },
  );

  // Отложенный кабинет — не успех: данные по нему остались вчерашними.
  // Следующий запуск начнёт именно с него.
  return NextResponse.json({
    ok: result.errors.length === 0 && result.skipped.length === 0,
    window: deep ? 'full' : `${LIGHT_WINDOW_DAYS}d`,
    ...result,
  });
}
