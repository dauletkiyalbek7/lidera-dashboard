import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { runDistributionForAll } from '@/lib/lead-distribution';

/**
 * Периодическая раздача лидов.
 *
 * Вызывается раз в минуту из самой базы (pg_cron + pg_net) — не из Vercel Cron:
 * на бесплатном тарифе он срабатывает раз в сутки, а возврат лида по SLA
 * должен происходить через минуты, иначе правило бессмысленно.
 *
 * Адрес публичный, поэтому доступ закрыт общим секретом. Отдельной переменной
 * для него нет намеренно: ключ — это sha256 от сервисного ключа Supabase,
 * который и так есть у обеих сторон. В базе лежит только хеш, сам ключ по сети
 * не ходит, и настраивать в хостинге ничего не нужно.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    console.error('cron/distribute: не задан SUPABASE_SERVICE_ROLE_KEY');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }

  const expected = createHash('sha256').update(serviceKey).digest('hex');

  if (request.headers.get('x-cron-key') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await runDistributionForAll();
  return NextResponse.json({ ok: true, ...result });
}
