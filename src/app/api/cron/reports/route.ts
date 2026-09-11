import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { runGroupReports } from '@/lib/group-report';

/**
 * Отчёты в группы Telegram — своим заходом, отдельно от раздачи лидов.
 *
 * Раньше они шли последними в общем планировщике и получали то, что от минуты
 * оставалось: раздача заявок, напоминания и сводка дня успевали съесть сорок,
 * а то и шестьдесят секунд. Отметка об отправке ставится до самой отправки,
 * поэтому оборванная функция означала не задержку, а потерянный отчёт — группа
 * не получала его до следующего дня.
 *
 * Теперь у отчётов своя минута целиком. Раздача лидов от этого не страдает:
 * она осталась в своём заходе и по-прежнему идёт первой.
 */

export const dynamic = 'force-dynamic';
// Перед отправкой платформа ходит в Meta за расходом по каждому проекту,
// а у сводного отчёта проектов несколько.
export const maxDuration = 60;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    console.error('cron/reports: не задан SUPABASE_SERVICE_ROLE_KEY');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }

  // Ключ тот же, что и у раздачи: общий секрет — sha256 от сервисного ключа
  // Supabase, который и так есть у обеих сторон.
  const expected = createHash('sha256').update(serviceKey).digest('hex');

  if (request.headers.get('x-cron-key') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const group = await runGroupReports(startedAt);

  return NextResponse.json({ ok: true, groupReports: group.sent });
}
