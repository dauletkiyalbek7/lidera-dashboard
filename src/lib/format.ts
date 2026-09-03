/**
 * Централизованное форматирование чисел, денег и дат.
 *
 * Валюта по умолчанию — тенге, но у компании она своя: рекламный кабинет может
 * выставлять счета в долларах, и подписать такую сумму знаком тенге нельзя.
 */

const RU = 'ru-RU';

/**
 * Пояс, в котором печатаются дата и время.
 *
 * Сервер живёт по Гринвичу, а заявка приходит по местному времени: без явного
 * пояса вечерняя заявка в 17:13 показывалась как 12:13, и менеджер не мог
 * сверить её со своим телефоном. У компании пояс свой (`companies.timezone`);
 * там, где компания под рукой, он и передаётся, а этот — на случай, когда
 * пояс неизвестен: почти все проекты в Алматы.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Almaty';

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

export function formatDate(value: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(RU, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
}

export function formatDateShort(value: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(RU, { day: '2-digit', month: 'short', timeZone }).format(date);
}

/**
 * Дата и время в переписке: день без года, потому что разговор всегда
 * недавний, а лишние цифры мешают читать его как чат.
 */
export function formatTime(value: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(RU, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function formatDateTime(value: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(RU, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

function trimZero(value: number): string {
  return formatNumber(value, value >= 100 ? 0 : 1);
}
