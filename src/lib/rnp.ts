import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { createRateLookup } from '@/lib/currency';
import { eachDay, zonedDayWindow, zonedIsoDate } from '@/lib/period';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * РНП — «рука на пульсе»: реклама проекта по дням одного месяца.
 *
 * Цифры берём из базы, а не у Meta: страница открывается когда угодно, а
 * кабинет и так перезабирается планировщиком каждые два часа (ночью — за
 * тридцать дней целиком). Поэтому сегодняшний день растёт в течение дня, а
 * вчерашний уточняется ещё сутки-двое, как и в самом кабинете.
 *
 * Читаем сервисным ключом, потому что у директора проекты бывают разные, а
 * база отдаёт пользователю только активный. Какие проекты ему можно показать,
 * решает страница — по его же профилям.
 */

/** Сколько строк отдаёт PostgREST за один запрос. */
const PAGE_SIZE = 1000;

/** Курсы берём с запасом назад: в выходные Нацбанк их не публикует. */
const RATE_LOOKBACK_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type RnpDay = {
  spendUsd: number;
  spendKzt: number;
  /** Результат кабинета: заявки с формы и начатые переписки. */
  results: number;
  reach: number;
  impressions: number;
  clicks: number;
  /** Заявки с рекламы, дошедшие до платформы. */
  platformLeads: number;
  /** Оплаченные продажи по дате продажи — все, не только с рекламы. */
  sales: number;
};

export type RnpProject = {
  id: string;
  name: string;
  /** По дню на каждую дату месяца, в том же порядке, что `RnpMonth.days`. */
  days: RnpDay[];
  total: RnpDay;
};

export type RnpMonth = {
  /** Месяц в виде 2026-10. */
  month: string;
  /** Даты месяца до сегодняшней включительно. */
  days: string[];
  today: string;
  projects: RnpProject[];
};

export const emptyDay = (): RnpDay => ({
  spendUsd: 0,
  spendKzt: 0,
  results: 0,
  reach: 0,
  impressions: 0,
  clicks: 0,
  platformLeads: 0,
  sales: 0,
});

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

/** Название проекта для адреса: «Вакансии» → vakansii, «bilimdibol.kz» → bilimdibol-kz. */
export function projectSlug(name: string): string {
  return [...name.toLowerCase()]
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Секрет открытой ссылки на РНП — подпись номера проекта сервисным ключом.
 *
 * Название в адресе только для глаз: его легко угадать, а платформа общая на
 * многих клиентов. Без подписи любой подставил бы чужое название и увидел
 * чужую рекламу. Хранить ничего не нужно; смена сервисного ключа отзывает все
 * ссылки разом.
 */
export function rnpKey(companyId: string): string | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`rnp-page:${companyId}`).digest('hex').slice(0, 24);
}

/** Проект открытой ссылки: название совпало и ключ подписан его номером. */
export async function findSharedProject(slug: string, key: string | undefined) {
  if (!key) return null;

  const supabase = createAdminSupabase();
  const { data } = await supabase.from('companies').select('id, name, timezone, currency');

  return (
    (data ?? []).find((company) => {
      if (projectSlug(company.name) !== slug) return false;
      const expected = rnpKey(company.id);
      return (
        expected !== null &&
        key.length === expected.length &&
        timingSafeEqual(Buffer.from(key), Buffer.from(expected))
      );
    }) ?? null
  );
}

/** Месяц из адреса, если он есть и не в будущем; иначе — текущий. */
export function resolveMonth(requested: string | undefined, timeZone: string): string {
  const current = zonedIsoDate(new Date(), timeZone).slice(0, 7);
  if (!requested || !MONTH_PATTERN.test(requested) || requested > current) return current;
  return requested;
}

/** Соседний месяц: shift = -1 — предыдущий, 1 — следующий. */
export function shiftMonth(month: string, shift: number): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + shift, 1));
  return date.toISOString().slice(0, 7);
}

export async function buildRnp(
  companies: { id: string; name: string; timezone: string | null; currency: string | null }[],
  month: string,
): Promise<RnpMonth> {
  const supabase = createAdminSupabase();

  // День — по часам первого проекта: проекты одного владельца живут в одном городе.
  const timezone = companies[0]?.timezone ?? 'Asia/Almaty';
  const today = zonedIsoDate(new Date(), timezone);
  const from = `${month}-01`;
  const monthEnd = new Date(Date.parse(`${shiftMonth(month, 1)}-01T00:00:00Z`) - DAY_MS)
    .toISOString()
    .slice(0, 10);
  const to = monthEnd < today ? monthEnd : today;
  const days = from <= to ? eachDay(from, to) : [];

  if (companies.length === 0 || days.length === 0) {
    return { month, days, today, projects: [] };
  }

  const companyIds = companies.map((company) => company.id);
  const rateSince = new Date(Date.parse(`${from}T00:00:00Z`) - RATE_LOOKBACK_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const [campaigns, metrics, leads, sales, rates] = await Promise.all([
    selectAll((start, end) =>
      supabase
        .from('campaigns')
        .select('id')
        .in('company_id', companyIds)
        .eq('counted', true)
        .order('id')
        .range(start, end),
    ),
    selectAll((start, end) =>
      supabase
        .from('ad_metrics')
        .select('company_id, campaign_id, date, spend, currency, reach, impressions, clicks, leads, conversations')
        .in('company_id', companyIds)
        .gte('date', from)
        .lte('date', to)
        .order('id')
        .range(start, end),
    ),
    // Заявки с рекламы — те, у которых есть площадка; написавшие сами сюда не идут.
    Promise.all(
      companies.map(async (company) => {
        const zone = company.timezone ?? timezone;
        const window = zonedDayWindow(from, to, zone);
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
          date: zonedIsoDate(new Date(row.created_at), zone),
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
  const counted = new Set(campaigns.map((row) => row.id));
  const companyCurrency = new Map(companies.map((row) => [row.id, row.currency]));
  const dayIndex = new Map(days.map((day, index) => [day, index]));

  const projects: RnpProject[] = companies.map((company) => ({
    id: company.id,
    name: company.name,
    days: days.map(emptyDay),
    total: emptyDay(),
  }));
  const projectById = new Map(projects.map((project) => [project.id, project]));

  /** День проекта, в который ложится строка; null — дата вне месяца. */
  const cell = (companyId: string, date: string): RnpDay | null => {
    const index = dayIndex.get(date);
    const project = projectById.get(companyId);
    return index === undefined || !project ? null : project.days[index];
  };

  for (const row of metrics) {
    // Считаем только кампании проекта: строки чужих и выключенных отсекаются здесь.
    if (!row.campaign_id || !counted.has(row.campaign_id)) continue;
    const day = cell(row.company_id, row.date);
    if (!day) continue;

    const spend = Number(row.spend ?? 0);
    // Пустая валюта у строки — валюта проекта (ручные записи и демо).
    const currency = row.currency ?? companyCurrency.get(row.company_id) ?? 'KZT';
    day.spendUsd += rate.convert(spend, currency, 'USD', row.date);
    day.spendKzt += rate.convert(spend, currency, 'KZT', row.date);
    day.results += (row.leads ?? 0) + (row.conversations ?? 0);
    day.reach += Number(row.reach ?? 0);
    day.impressions += Number(row.impressions ?? 0);
    day.clicks += Number(row.clicks ?? 0);
  }

  for (const lead of leads.flat()) {
    const day = cell(lead.companyId, lead.date);
    if (day) day.platformLeads += 1;
  }

  for (const sale of sales) {
    const day = cell(sale.company_id, sale.sale_date);
    if (day) day.sales += 1;
  }

  for (const project of projects) {
    for (const day of project.days) addDay(project.total, day);
  }

  return { month, days, today, projects };
}

export function addDay(target: RnpDay, day: RnpDay): void {
  target.spendUsd += day.spendUsd;
  target.spendKzt += day.spendKzt;
  target.results += day.results;
  target.reach += day.reach;
  target.impressions += day.impressions;
  target.clicks += day.clicks;
  target.platformLeads += day.platformLeads;
  target.sales += day.sales;
}

async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    // Обрыв посреди выборки дал бы РНП с дырой, похожей на правду.
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}
