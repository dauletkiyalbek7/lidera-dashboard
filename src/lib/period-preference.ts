import 'server-only';

import { cookies } from 'next/headers';

import { resolveRange, type DateRange } from '@/lib/period';

/**
 * Запомненный период.
 *
 * Директор выбирает месяц в «Рекламе», переходит в «Лиды» — и там снова
 * последние семь дней. Каждый раздел начинал с чистого листа, потому что
 * период живёт в адресе страницы, а переход по меню адрес не переносит.
 *
 * Поэтому выбор дублируется в куку и подставляется там, где в адресе периода
 * нет. Адрес остаётся главнее куки: ссылка с конкретными датами должна
 * открываться именно так, как её прислали.
 */
const PERIOD_COOKIE = 'lidera_period';

type PeriodParams = { period?: string; from?: string; to?: string };

export async function currentRange(
  params: PeriodParams,
  timeZone?: string,
): Promise<DateRange> {
  if (params.period || (params.from && params.to)) return resolveRange(params, timeZone);

  const saved = (await cookies()).get(PERIOD_COOKIE)?.value;
  if (!saved) return resolveRange(params, timeZone);

  // Кука хранит те же поля, что и адрес, — значит разбирать её нечем особенным.
  // Мусор внутри не страшен: resolveRange проверяет и даты, и имя пресета, а
  // на непонятное отвечает периодом по умолчанию.
  const stored = new URLSearchParams(saved);

  return resolveRange(
    {
      period: stored.get('period') ?? undefined,
      from: stored.get('from') ?? undefined,
      to: stored.get('to') ?? undefined,
    },
    timeZone,
  );
}
