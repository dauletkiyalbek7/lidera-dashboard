/** Диапазон дат — общий для всех разделов кабинета. */

export const PERIODS = [
  { key: '7d', label: '7 дней', days: 7 },
  { key: '30d', label: '30 дней', days: 30 },
  { key: '90d', label: '90 дней', days: 90 },
] as const;

export type PeriodKey = (typeof PERIODS)[number]['key'];

export const DEFAULT_PERIOD: PeriodKey = '30d';

export function resolvePeriod(value: string | undefined): {
  key: PeriodKey;
  days: number;
  label: string;
  from: string;
  to: string;
} {
  const period = PERIODS.find((item) => item.key === value) ?? PERIODS[1];
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (period.days - 1));

  return {
    key: period.key,
    days: period.days,
    label: period.label,
    from: toIsoDate(from),
    to: toIsoDate(to),
  };
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Список всех дат периода — чтобы в графике не было пропущенных дней. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
