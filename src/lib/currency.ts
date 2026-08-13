import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Пересчёт валют по курсу Нацбанка РК.
 *
 * Рекламный кабинет считает в своей валюте (у MIRAS это доллары), кабинет
 * компании показывает деньги в валюте компании. Подписать доллары знаком тенге
 * нельзя — это разные суммы, поэтому расход пересчитывается по курсу того дня,
 * когда он был потрачен.
 *
 * Опорная валюта — тенге: храним «сколько тенге стоит единица валюты», и любая
 * пара считается через тенге.
 */

export const RATE_CODES = ['USD', 'EUR', 'RUB'] as const;
export type RateCode = (typeof RATE_CODES)[number];

export type RateRow = { date: string; code: string; kzt_per_unit: number | string };

/** Курс тенге за единицу валюты. Для самого тенге — единица. */
export type RateLookup = {
  /** Сколько тенге стоит одна единица валюты на эту дату. */
  kztPerUnit(code: string, date: string): number | null;
  /** Пересчёт суммы между валютами на дату. Без курса возвращает исходную сумму. */
  convert(amount: number, from: string, to: string, date: string): number;
  /** Последний известный курс — для подписи «курс на такое-то число». */
  latest(code: string): { date: string; rate: number } | null;
  /** Есть ли вообще курсы: без них подпись про курс показывать нечестно. */
  readonly empty: boolean;
};

export function createRateLookup(rows: RateRow[]): RateLookup {
  // По каждой валюте — даты по возрастанию: ищем ближайший курс не позже даты.
  const byCode = new Map<string, { date: string; rate: number }[]>();

  for (const row of rows) {
    const rate = Number(row.kzt_per_unit);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const list = byCode.get(row.code) ?? [];
    list.push({ date: row.date, rate });
    byCode.set(row.code, list);
  }

  for (const list of byCode.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  function kztPerUnit(code: string, date: string): number | null {
    if (code === 'KZT') return 1;
    const list = byCode.get(code);
    if (!list || list.length === 0) return null;

    // Курс на дату: последний опубликованный не позже неё. В выходные Нацбанк
    // курс не публикует, поэтому берётся пятничный — так же считает бухгалтерия.
    let found: number | null = null;
    for (const point of list) {
      if (point.date <= date) found = point.rate;
      else break;
    }
    // Дата раньше первого известного курса (старые данные) — берём самый ранний.
    return found ?? list[0].rate;
  }

  return {
    kztPerUnit,
    convert(amount, from, to, date) {
      if (!amount || from === to) return amount;
      const fromRate = kztPerUnit(from, date);
      const toRate = kztPerUnit(to, date);
      if (!fromRate || !toRate) return amount;
      return (amount * fromRate) / toRate;
    },
    latest(code) {
      if (code === 'KZT') return null;
      const list = byCode.get(code);
      return list && list.length > 0 ? list[list.length - 1] : null;
    },
    get empty() {
      return byCode.size === 0;
    },
  };
}

type NbkItem = { code: string; kztPerUnit: number };

/**
 * Курсы Нацбанка на дату. Формат ответа — XML со списком валют, где
 * `description` — цена `quant` единиц в тенге.
 */
export async function fetchNbkRates(date: Date): Promise<NbkItem[]> {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const url = `https://nationalbank.kz/rss/get_rates.cfm?fdate=${day}.${month}.${date.getUTCFullYear()}`;

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Нацбанк ответил ${response.status}`);

  const xml = await response.text();
  const items: NbkItem[] = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const code = block.match(/<title>(.*?)<\/title>/)?.[1]?.trim();
    if (!code || !(RATE_CODES as readonly string[]).includes(code)) continue;

    const value = Number(block.match(/<description>(.*?)<\/description>/)?.[1]);
    const quant = Number(block.match(/<quant>(.*?)<\/quant>/)?.[1] ?? 1) || 1;
    if (!Number.isFinite(value) || value <= 0) continue;

    items.push({ code, kztPerUnit: Number((value / quant).toFixed(6)) });
  }

  return items;
}

/** Даты периода в UTC, от свежей к старой. */
function daysBack(count: number): Date[] {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - index),
    );
    return date;
  });
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Докачивает недостающие курсы.
 *
 * Каждый день нужен один запрос, но при первом запуске (и после долгого
 * простоя) добираем историю: расход за прошлый месяц должен считаться по курсу
 * того месяца. За выходные Нацбанк курс не публикует — такие дни просто
 * остаются пустыми, и пересчёт берёт ближайший рабочий.
 */
export async function syncExchangeRates(
  supabase: SupabaseClient<Database>,
  historyDays = 45,
): Promise<{ fetched: number; days: number }> {
  const { data: existing } = await supabase.from('exchange_rates').select('date');
  const known = new Set((existing ?? []).map((row) => row.date));

  const missing = daysBack(historyDays).filter((date) => !known.has(isoDate(date)));
  if (missing.length === 0) return { fetched: 0, days: 0 };

  const rows: { date: string; code: string; kzt_per_unit: number }[] = [];

  for (const date of missing) {
    const items = await fetchNbkRates(date).catch(() => []);
    for (const item of items) {
      rows.push({ date: isoDate(date), code: item.code, kzt_per_unit: item.kztPerUnit });
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('exchange_rates')
      .upsert(rows, { onConflict: 'date,code' });
    if (error) throw new Error(`не удалось сохранить курсы: ${error.message}`);
  }

  return { fetched: rows.length, days: missing.length };
}
