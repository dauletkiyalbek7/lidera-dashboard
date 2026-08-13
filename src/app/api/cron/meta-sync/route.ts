import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isMetaConfigured, syncAllMetaAccounts } from '@/lib/meta-sync';

/**
 * Ночная синхронизация с Meta Ads.
 *
 * Раз в сутки достаточно: рекламный кабинет уточняет вчерашние цифры ещё
 * пару дней, поэтому каждый запуск перезабирает последние 30 дней целиком.
 *
 * Доступ закрыт тем же общим секретом, что и раздача лидов: sha256 от
 * сервисного ключа Supabase. Отдельной переменной для крона не нужно.
 */

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

  const result = await syncAllMetaAccounts();

  return NextResponse.json({
    ok: result.errors.length === 0,
    ...result,
  });
}
