import { NextResponse } from 'next/server';

import { runDistributionForAll } from '@/lib/lead-distribution';

/**
 * Периодическая раздача лидов.
 *
 * Вызывается раз в минуту из самой базы (pg_cron + pg_net) — не из Vercel Cron:
 * на бесплатном тарифе он срабатывает раз в сутки, а возврат лида по SLA
 * должен происходить через минуты, иначе правило бессмысленно.
 *
 * Адрес публичный, поэтому доступ закрыт секретом в заголовке. Без него
 * посторонний мог бы гонять раздачу и перекидывать чужие лиды.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error('cron/distribute: не задан CRON_SECRET');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }

  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await runDistributionForAll();
  return NextResponse.json({ ok: true, ...result });
}
