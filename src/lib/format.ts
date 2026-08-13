/**
 * Централизованное форматирование чисел, денег и дат.
 *
 * Валюта по умолчанию — тенге, но у компании она своя: рекламный кабинет может
 * выставлять счета в долларах, и подписать такую сумму знаком тенге нельзя.
 */

const RU = 'ru-RU';

export const CURRENCIES = {
  KZT: { symbol: '₸', label: 'Тенге ₸' },
  USD: { symbol: '$', label: 'Доллар $' },
  EUR: { symbol: '€', label: 'Евро €' },
  RUB: { symbol: '₽', label: 'Рубль ₽' },
} as const;

export type Currency = keyof typeof CURRENCIES;

export function currencySymbol(currency?: string): string {
  return CURRENCIES[currency as Currency]?.symbol ?? CURRENCIES.KZT.symbol;
}

export function formatMoney(
  value: number,
  options?: { compact?: boolean; currency?: string },
): string {
  const symbol = currencySymbol(options?.currency);

  if (options?.compact && Math.abs(value) >= 1_000_000) {
    return `${trimZero(value / 1_000_000)} млн ${symbol}`;
  }
  if (options?.compact && Math.abs(value) >= 10_000) {
    return `${trimZero(value / 1000)} тыс ${symbol}`;
  }

  // Доллары и евро округлять до целых нельзя: расход в 0,98 превратился бы в 1.
  const fractionDigits = symbol === '₸' || Math.abs(value) >= 1000 ? 0 : 2;

  return `${new Intl.NumberFormat(RU, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)} ${symbol}`;
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
