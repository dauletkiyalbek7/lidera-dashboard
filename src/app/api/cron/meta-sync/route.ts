import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isMetaConfigured, syncAllMetaAccounts } from '@/lib/meta-sync';
import { isTikTokConfigured, syncAllTikTokAccounts } from '@/lib/tiktok-sync';

/**
 * Синхронизация рекламных кабинетов: каждые два часа, глубокая — раз в сутки.
 *
 * Кабинетов два вида — Meta и TikTok, — и ходим в оба одним запуском: у них
 * общая модель данных и общий смысл «свежие цифры к ближайшему отчёту».
 * Отказ одного не должен уносить второй, поэтому TikTok идёт своей веткой.
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

  const deep = new Date().getUTCHours() === 0;
  const windowDays = deep ? undefined : LIGHT_WINDOW_DAYS;

  const meta = isMetaConfigured()
    ? await syncAllMetaAccounts(deep ? undefined : { windowDays: LIGHT_WINDOW_DAYS })
    : null;

  // TikTok считаем отдельно: у него свой токен, и отсутствие одного из двух
  // кабинетов — обычное дело, а не повод отменить весь запуск.
  const tiktok = (await isTikTokConfigured())
    ? await syncAllTikTokAccounts(windowDays ? { windowDays } : undefined)
    : null;

  if (!meta && !tiktok) {
    return NextResponse.json(
      { error: 'ни один рекламный кабинет не подключён' },
      { status: 503 },
    );
  }

  // Отложенный кабинет — не успех: данные по нему остались вчерашними.
  // Следующий запуск начнёт именно с него.
  return NextResponse.json({
    ok:
      (meta?.errors.length ?? 0) === 0 &&
      (meta?.skipped.length ?? 0) === 0 &&
      (tiktok?.errors.length ?? 0) === 0,
    window: deep ? 'full' : `${LIGHT_WINDOW_DAYS}d`,
    ...(meta ?? {}),
    ...(tiktok ? { tiktok } : {}),
  });
}
