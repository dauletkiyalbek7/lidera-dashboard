import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { createRateLookup } from '@/lib/currency';
import { zonedDayWindow, zonedIsoDate } from '@/lib/period';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Данные сводного отчёта для Google Таблицы.
 *
 * Таблица сама забирает их формулой IMPORTDATA по секретной ссылке: так
 * платформе не нужны ни ключи Google, ни доступ к чужому диску, а таблица
 * обновляется без нашего участия. Ссылка ведёт либо на сводный код отчёта —
 * тогда проекты те же, что в группе Telegram, — либо на один проект.
 *
 * Цифры берём из базы, а не у Meta: Google перечитывает ссылку когда захочет,
 * и каждый такой заход в кабинет быстро упёрся бы в ограничение частоты.
 */

/** Сколько строк отдаёт PostgREST за один запрос. */
const PAGE_SIZE = 1000;

/** Самый длинный период, который отдаём за раз: таблица не резиновая. */
const MAX_DAYS = 400;

/** Период по умолчанию, если в ссылке не сказано, с какого дня. */
const DEFAULT_DAYS = 90;

/** Курсы берём с запасом назад: в выходные Нацбанк их не публикует. */
const RATE_LOOKBACK_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SheetView = 'days' | 'campaigns';

/**
 * Секрет ссылки — подпись номера кода или проекта сервисным ключом.
 *
 * Номера уникальны, поэтому ключ одного проекта не откроет ни соседний
 * проект, ни код, в который тот входит.
 *
 * Хранить отдельно ничего не нужно: кто знает ключ, тот получит ту же подпись,
 * а без ключа её не подобрать. Смена сервисного ключа отзывает все ссылки.
 */
export function sheetKey(scopeId: string): string | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`report-sheet:${scopeId}`).digest('hex').slice(0, 32);
}

export function isSheetKeyValid(scopeId: string, key: string | null): boolean {
  const expected = sheetKey(scopeId);
  if (!expected || !key || key.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(expected));
}

type Totals = {
  spendUsd: number;
  spendKzt: number;
  results: number;
  impressions: number;
  clicks: number;
};

const emptyTotals = (): Totals => ({ spendUsd: 0, spendKzt: 0, results: 0, impressions: 0, clicks: 0 });

/** Строки CSV для таблицы; null — нет ни такого кода, ни такого проекта. */
export async function buildReportSheet(
  scopeId: string,
  view: SheetView,
  requestedFrom: string | null,
): Promise<string[][] | null> {
  const supabase = createAdminSupabase();

  const { data: links } = await supabase
    .from('report_code_companies')
    .select('company_id')
    .eq('code_id', scopeId);

  // Не код — значит, ссылка на один проект; есть ли он, покажет выборка ниже.
  const companyIds = links && links.length > 0 ? links.map((row) => row.company_id) : [scopeId];

  const { data: companyRows } = await supabase
    .from('companies')
    .select('id, name, timezone, currency')
    .in('id', companyIds);

  const companies = (companyRows ?? []).sort((a, b) => a.name.localeCompare(b.name));
  if (companies.length === 0) return null;

  // День — по часам первого проекта: у одного кода проекты живут в одном городе.
  const timezone = companies[0].timezone ?? 'Asia/Almaty';
  const to = zonedIsoDate(new Date(), timezone);
  const from = clampFrom(requestedFrom, to);
  const days = dateRange(from, to);

  const rateSince = new Date(Date.parse(`${from}T00:00:00Z`) - RATE_LOOKBACK_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const [campaigns, accounts, metrics, leads, sales, rates] = await Promise.all([
    selectAll((start, end) =>
      supabase
        .from('campaigns')
        .select('id, company_id, ad_account_id, name, platform')
        .in('company_id', companyIds)
        .eq('counted', true)
        .order('id')
        .range(start, end),
    ),
    supabase.from('ad_accounts').select('id, account_name').in('company_id', companyIds),
    selectAll((start, end) =>
      supabase
        .from('ad_metrics')
        .select('company_id, campaign_id, date, spend, currency, impressions, clicks, leads, conversations')
        .in('company_id', companyIds)
        .gte('date', from)
        .lte('date', to)
        .order('id')
        .range(start, end),
    ),
    // Заявки с рекламы — те, у которых есть площадка; написавшие сами сюда не идут.
    Promise.all(
      companies.map(async (company) => {
        const window = zonedDayWindow(from, to, company.timezone ?? timezone);
        const rows = await selectAll((start, end) =>
          supabase
            .from('leads')
            .select('created_at')
            .eq('company_id', company.id)
            .not('platform', 'is', null)
            .gte('created_at', window.startsAt)
            .lt('created_at', window.endsBefore)
            .order('id')
            .range(start, end),
        );
        return rows.map((row) => ({
          companyId: company.id,
          date: zonedIsoDate(new Date(row.created_at), company.timezone ?? timezone),
        }));
      }),
    ),
    selectAll((start, end) =>
      supabase
        .from('sales')
        .select('company_id, sale_date')
        .in('company_id', companyIds)
        .eq('status', 'paid')
        .gte('sale_date', from)
        .lte('sale_date', to)
        .order('id')
        .range(start, end),
    ),
    supabase.from('exchange_rates').select('date, code, kzt_per_unit').gte('date', rateSince),
  ]);

  const rate = createRateLookup(rates.data ?? []);
  const campaignById = new Map(campaigns.map((row) => [row.id, row]));
  const accountName = new Map((accounts.data ?? []).map((row) => [row.id, row.account_name]));
  const companyName = new Map(companies.map((row) => [row.id, row.name]));
  const companyCurrency = new Map(companies.map((row) => [row.id, row.currency]));

  // Считаем только кампании проекта: строки чужих и выключенных отсекаются здесь.
  const byDay = new Map<string, Totals>();
  const byCampaign = new Map<string, Totals>();

  for (const row of metrics) {
    if (!row.campaign_id || !campaignById.has(row.campaign_id)) continue;

    const spend = Number(row.spend ?? 0);
    // Пустая валюта у строки — валюта проекта (ручные записи и демо).
    const currency = row.currency ?? companyCurrency.get(row.company_id) ?? 'KZT';
    const add = (totals: Totals) => {
      totals.spendUsd += rate.convert(spend, currency, 'USD', row.date);
      totals.spendKzt += rate.convert(spend, currency, 'KZT', row.date);
      // Результат кабинета: заявка или начатая переписка — как в отчёте Telegram.
      totals.results += (row.leads ?? 0) + (row.conversations ?? 0);
      totals.impressions += Number(row.impressions ?? 0);
      totals.clicks += Number(row.clicks ?? 0);
    };

    add(getOr(byDay, `${row.date}|${row.company_id}`, emptyTotals));
    add(getOr(byCampaign, `${row.date}|${row.campaign_id}`, emptyTotals));
  }

  if (view === 'campaigns') {
    const rows: string[][] = [
      ['Дата', 'Проект', 'Кабинет', 'Площадка', 'Кампания', 'Расход $', 'Расход ₸', 'Лиды (кабинет)', 'Цена лида ₸', 'Показы', 'Клики', 'CTR %'],
    ];

    const keys = [...byCampaign.keys()].sort((a, b) => {
      const [dayA, idA] = a.split('|');
      const [dayB, idB] = b.split('|');
      if (dayA !== dayB) return dayA.localeCompare(dayB);
      const campaignA = campaignById.get(idA)!;
      const campaignB = campaignById.get(idB)!;
      return (
        (companyName.get(campaignA.company_id) ?? '').localeCompare(companyName.get(campaignB.company_id) ?? '') ||
        (campaignA.name ?? '').localeCompare(campaignB.name ?? '')
      );
    });

    for (const key of keys) {
      const totals = byCampaign.get(key)!;
      if (totals.spendUsd === 0 && totals.impressions === 0 && totals.results === 0) continue;

      const [day, id] = key.split('|');
      const campaign = campaignById.get(id)!;
      rows.push([
        day,
        companyName.get(campaign.company_id) ?? '',
        campaign.ad_account_id ? (accountName.get(campaign.ad_account_id) ?? '') : '',
        campaign.platform ?? '',
        campaign.name ?? '',
        money(totals.spendUsd),
        money(totals.spendKzt),
        String(totals.results),
        ratio(totals.spendKzt, totals.results),
        String(totals.impressions),
        String(totals.clicks),
        percent(totals.clicks, totals.impressions),
      ]);
    }

    return rows;
  }

  const platformLeads = new Map<string, number>();
  for (const lead of leads.flat()) {
    const key = `${lead.date}|${lead.companyId}`;
    platformLeads.set(key, (platformLeads.get(key) ?? 0) + 1);
  }

  // Сумму продаж в таблицу не отдаём, только их число.
  const salesByDay = new Map<string, number>();
  for (const sale of sales) {
    const key = `${sale.sale_date}|${sale.company_id}`;
    salesByDay.set(key, (salesByDay.get(key) ?? 0) + 1);
  }

  const rows: string[][] = [
    ['Дата', 'Проект', 'Расход $', 'Расход ₸', 'Лиды (кабинет)', 'Цена лида ₸', 'Лиды в платформе', 'Показы', 'Клики', 'CTR %', 'CPC ₸', 'CPM ₸', 'Продажи', 'CAC ₸'],
  ];

  for (const day of days) {
    for (const company of companies) {
      const key = `${day}|${company.id}`;
      const totals = byDay.get(key) ?? emptyTotals();
      const sold = salesByDay.get(key) ?? 0;

      rows.push([
        day,
        company.name,
        money(totals.spendUsd),
        money(totals.spendKzt),
        String(totals.results),
        ratio(totals.spendKzt, totals.results),
        String(platformLeads.get(key) ?? 0),
        String(totals.impressions),
        String(totals.clicks),
        percent(totals.clicks, totals.impressions),
        ratio(totals.spendKzt, totals.clicks),
        totals.impressions ? money((totals.spendKzt / totals.impressions) * 1000) : '',
        String(sold),
        ratio(totals.spendKzt, sold),
      ]);
    }
  }

  return rows;
}

/** Строки в CSV: запятая и точка в дробях — таблица читает их с локалью en_US. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function clampFrom(requested: string | null, to: string): string {
  const toMs = Date.parse(`${to}T00:00:00Z`);
  const earliest = toMs - (MAX_DAYS - 1) * DAY_MS;
  const fallback = toMs - (DEFAULT_DAYS - 1) * DAY_MS;

  const parsed = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? Date.parse(`${requested}T00:00:00Z`) : NaN;
  const fromMs = Number.isFinite(parsed) ? Math.min(Math.max(parsed, earliest), toMs) : fallback;

  return new Date(fromMs).toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += DAY_MS) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

function money(value: number): string {
  return value ? value.toFixed(2) : '0';
}

/** Пустая ячейка, когда делить не на что: ноль в цене лида читался бы как «бесплатно». */
function ratio(amount: number, count: number): string {
  return count ? (amount / count).toFixed(2) : '';
}

function percent(part: number, whole: number): string {
  return whole ? ((part / whole) * 100).toFixed(2) : '';
}

function getOr<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}

async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    // Обрыв посреди выборки дал бы таблицу с дырой, похожей на правду.
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}
