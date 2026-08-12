/** Централизованное форматирование чисел, денег и дат. Валюта — тенге. */

const RU = 'ru-RU';

export function formatMoney(value: number, options?: { compact?: boolean }): string {
  if (options?.compact && Math.abs(value) >= 1_000_000) {
    return `${trimZero(value / 1_000_000)} млн ₸`;
  }
  if (options?.compact && Math.abs(value) >= 10_000) {
    return `${trimZero(value / 1000)} тыс ₸`;
  }
  return `${new Intl.NumberFormat(RU, { maximumFractionDigits: 0 }).format(
    Math.round(value),
  )} ₸`;
}

export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(RU, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${formatNumber(value, fractionDigits)}%`;
}

export function formatRatio(value: number): string {
  return formatNumber(value, value >= 10 ? 1 : 2);
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(RU, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateShort(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(RU, { day: '2-digit', month: 'short' }).format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(RU, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function trimZero(value: number): string {
  return formatNumber(value, value >= 100 ? 0 : 1);
}
