import 'server-only';

import type { TrendPoint } from '@/components/charts/trend-chart';
import { resolveShiftRules, type ShiftRules } from '@/lib/attendance';
import { creativeLabel } from '@/lib/creative-label';
import { createRateLookup } from '@/lib/currency';
import { countUntouched, isReached, leadStage } from '@/lib/lead-status';
import { wasHeld } from '@/lib/trial-status';
import { eachDay, zonedDayWindow, zonedIsoDate } from '@/lib/period';
import {
  emptyPerformance,
  summarize,
  type PerformanceInput,
  type PerformanceSummary,
} from '@/lib/metrics';
import { createServerSupabase } from '@/lib/supabase/server';

export { creativeLabel };

/**
 * Запросы кабинета компании.
 *
 * Клиент здесь — пользовательский, поэтому RLS остаётся в силе: даже если
 * companyId подменить, база вернёт пустой результат. Явный фильтр по
 * company_id оставлен ради индексов и читаемости.
 */

/** Строка расхода: сумма, её валюта и день, по курсу которого считаем. */
type SpendRow = {
  spend: number | string;
  date: string;
  currency?: string | null;
  /** Сумма до пересчёта — в валюте кабинета. Проставляется при конверсии. */
  spend_source?: number;
};

/**
 * Приводит расход рекламного кабинета к валюте продаж компании.
 *
 * Считать деньги надо в одной валюте: прибыль это выручка минус расход, а
 * выручка приходит в тенге. Поэтому база расчёта — валюта продаж, и расход
 * пересчитывается в неё по курсу Нацбанка на свой день.
 *
 * Показывать расход при этом можно в валюте кабинета — исходная сумма
 * остаётся рядом, в spend_source.
 */
async function toCompanyCurrency<T extends SpendRow>(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  rows: T[],
): Promise<(T & { spend_source?: number })[]> {
  if (rows.length === 0) return rows;

  const { data: company } = await supabase
    .from('companies')
    .select('sales_currency')
    .eq('id', companyId)
    .maybeSingle();

  const target = company?.sales_currency ?? 'KZT';

  // Пересчёт нужен, только если валюта расхода отличается от валюты компании.
  const foreign = rows.some((row) => row.currency && row.currency !== target);
  if (!foreign) return rows;

  const { data: rates } = await supabase
    .from('exchange_rates')
    .select('date, code, kzt_per_unit')
    .order('date', { ascending: true });

  const lookup = createRateLookup(rates ?? []);

  // Исходную сумму сохраняем рядом: расход директор сверяет с рекламным
  // кабинетом, а тот считает в своей валюте. Показать только пересчёт значит
  // заставить его каждый раз делить в уме.
  return rows.map((row) => {
    const source = row.currency;
    if (!source || source === target) return row;
    return {
      ...row,
      spend: lookup.convert(Number(row.spend), source, target, row.date),
      spend_source: Number(row.spend),
    };
  });
}

/**
 * Убирает строки кампаний, выключенных из отчётов.
 *
 * В одном кабинете рядом крутятся курсы и наём: соискатель — не клиент, и в
 * цене лида ему не место.
 */
async function withoutSkippedCampaigns<T extends { campaign_id?: string | null }>(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const excluded = await selectAll((start, end) =>
    supabase
      .from('campaigns')
      .select('id')
      .eq('company_id', companyId)
      .eq('counted', false)
      .range(start, end),
  );

  if (excluded.length === 0) return rows;

  const skipped = new Set(excluded.map((row) => row.id));
  return rows.filter((row) => !row.campaign_id || !skipped.has(row.campaign_id));
}

/**
 * Кампания → отдел продаж.
 *
 * Отдел стоит на кампании, а расход и показы приходят строками статистики,
 * где от кампании остался только её номер. Поэтому раскладку строим один раз
 * и потом делим по ней рекламные строки любого раздела.
 */
async function departmentByCampaign(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
): Promise<Map<string, string | null>> {
  const rows = await selectAll<{ id: string; department_id: string | null }>((start, end) =>
    supabase
      .from('campaigns')
      .select('id, department_id')
      .eq('company_id', companyId)
      .range(start, end),
  );

  return new Map(rows.map((row) => [row.id, row.department_id]));
}

/** Оставить только рекламные строки выбранного отдела. */
function adRowsOfDepartment<T extends { campaign_id?: string | null }>(
  rows: T[],
  departments: Map<string, string | null>,
  departmentId: string,
): T[] {
  return rows.filter((row) => row.campaign_id && departments.get(row.campaign_id) === departmentId);
}

export type CurrencyNote = {
  /** Валюта рекламного кабинета. */
  source: string;
  /** Валюта отчётов компании. */
  target: string;
  /** Последний известный курс: сколько единиц target стоит одна единица source. */
  rate: number;
  /** Дата этого курса — чтобы было видно, свежий он или нет. */
  date: string;
};

/**
 * Пояснение к пересчёту: какой курс применён к расходу кабинета.
 * Возвращает null, когда пересчитывать нечего — валюты совпадают.
 */
export async function getCurrencyNote(
  companyId: string,
  companyCurrency: string,
): Promise<CurrencyNote | null> {
  const supabase = await createServerSupabase();

  const { data: accounts } = await supabase
    .from('ad_accounts')
    .select('currency')
    .eq('company_id', companyId)
    .not('currency', 'is', null);

  const source = accounts?.find((row) => row.currency && row.currency !== companyCurrency)
    ?.currency;
  if (!source) return null;

  const { data: rates } = await supabase
    .from('exchange_rates')
    .select('date, code, kzt_per_unit')
    .order('date', { ascending: true });

  const lookup = createRateLookup(rates ?? []);
  const latest = lookup.latest(source) ?? lookup.latest(companyCurrency);
  if (!latest) return null;

  const rate = lookup.convert(1, source, companyCurrency, latest.date);
  if (rate === 1) return null;

  return { source, target: companyCurrency, rate, date: latest.date };
}

/**
 * Валюта рекламного кабинета компании.
 *
 * null, если кабинета нет или их несколько в разных валютах: складывать
 * доллары с евро нельзя, и тогда честнее показывать всё в валюте продаж.
 */
export async function getAdSpendCurrency(companyId: string): Promise<string | null> {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from('ad_accounts')
    .select('currency')
    .eq('company_id', companyId)
    .not('currency', 'is', null);

  const codes = new Set((data ?? []).map((row) => row.currency).filter(Boolean));
  return codes.size === 1 ? (codes.values().next().value ?? null) : null;
}

export type CreativePerformance = PerformanceSummary & {
  id: string;
  name: string;
  platform: string;
  format: string | null;
  /** Расход в валюте кабинета. null — пересчёта не было, берите spend. */
  spendSource: number | null;
};

/** Итог одного отдела продаж: его кампании против его же заявок. */
export type DepartmentTotals = {
  id: string;
  name: string;
  spend: number;
  /** Расход в валюте кабинета — до пересчёта. */
  spendSource: number | null;
  leads: number;
  sales: number;
  revenue: number;
};

export type DashboardData = {
  totals: PerformanceSummary;
  /** Общий расход в валюте кабинета. null — пересчёта не было. */
  spendSource: number | null;
  trend: TrendPoint[];
  creatives: CreativePerformance[];
  hasAdData: boolean;
  /**
   * Разбивка по отделам продаж — пусто, если отдел один или уже выбран
   * конкретный: тогда вся страница и есть его срез.
   */
  departments: DepartmentTotals[];
};

export async function getDashboardData(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
  departmentId?: string | null,
): Promise<DashboardData> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const [metricsRows, creativesResult, trialsResult, salesResult, leadRows, departmentsResult] =
    await Promise.all([
    selectAll((start, end) =>
      supabase
        .from('ad_metrics')
        .select('creative_id, campaign_id, date, spend, impressions, clicks, leads, conversations, currency')
        .eq('company_id', companyId)
        .gte('date', from)
        .lte('date', to)
        .range(start, end),
    ),
    supabase
      .from('creatives')
      .select('id, name, label, platform, format, created_at')
      .eq('company_id', companyId)
      // Порядок важен: номер в подписи «Видео 7» — это место в списке.
      .order('created_at')
      .order('id'),
    supabase
      .from('trials')
      .select('id, date, status, lead_id')
      .eq('company_id', companyId)
      .gte('date', from)
      .lte('date', to),
    supabase
      .from('sales')
      .select('id, sale_date, amount, status, lead_id')
      .eq('company_id', companyId)
      .eq('status', 'paid')
      .gte('sale_date', from)
      .lte('sale_date', to),
    selectAll((start, end) => {
      let query = supabase
        .from('leads')
        .select('id, creative_id, status, department_id')
        .eq('company_id', companyId)
        .gte('created_at', day.startsAt)
        .lt('created_at', day.endsBefore)
        .range(start, end);

      if (departmentId) query = query.eq('department_id', departmentId);
      return query;
    }),
    supabase
      .from('departments')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .order('name'),
  ]);

  const countedMetrics = await withoutSkippedCampaigns(
    supabase,
    companyId,
    await toCompanyCurrency(supabase, companyId, metricsRows),
  );

  // Разбивка нужна, только когда отделов несколько и не выбран один из них:
  // при выбранном отделе вся страница и есть его срез.
  const allDepartments = departmentsResult.data ?? [];
  const splitByDepartment = !departmentId && allDepartments.length > 1;

  // Отдел стоит на кампании, а расход приходит её строками статистики.
  const campaignDepartments =
    departmentId || splitByDepartment
      ? await departmentByCampaign(supabase, companyId)
      : new Map<string, string | null>();

  // Выбран отдел — оставляем только его: расход берём по кампаниям отдела,
  // а продажи и занятия — по его заявкам. Продажа без заявки в срез отдела не
  // попадает: чья она — неизвестно.
  const metrics = departmentId
    ? adRowsOfDepartment(countedMetrics, campaignDepartments, departmentId)
    : countedMetrics;

  const creatives = creativesResult.data ?? [];
  const leads = leadRows;

  const ownLeads = new Set(leads.map((lead) => lead.id));
  const ofDepartment = <T extends { lead_id: string | null }>(rows: T[]) =>
    departmentId ? rows.filter((row) => row.lead_id && ownLeads.has(row.lead_id)) : rows;

  const trials = ofDepartment(trialsResult.data ?? []);
  const sales = ofDepartment(salesResult.data ?? []);

  // Лид → креатив: связь, ради которой существует вся платформа.
  const leadToCreative = new Map(leads.map((lead) => [lead.id, lead.creative_id]));

  // «Обработан» = с человеком реально поговорили. Отказ тоже обработан,
  // а недозвон и нецелевой — нет: см. lib/lead-status.ts.
  const totals = summarize({
    spend: sum(metrics, (row) => Number(row.spend)),
    impressions: sum(metrics, (row) => Number(row.impressions)),
    clicks: sum(metrics, (row) => Number(row.clicks)),
    leads: leads.length,
    // Урок состоялся — это и «Проведён», и исходы после него: клиент купил
    // или отказался уже после занятия.
    trials: trials.filter((trial) => wasHeld(trial.status)).length,
    processed: leads.filter((lead) => isReached(lead.status)).length,
    sales: sales.length,
    revenue: sum(sales, (row) => Number(row.amount)),
  });

  // --- Динамика по дням --------------------------------------------------
  const spendByDay = new Map<string, number>();
  for (const row of metrics) {
    spendByDay.set(row.date, (spendByDay.get(row.date) ?? 0) + Number(row.spend));
  }
  const revenueByDay = new Map<string, number>();
  for (const row of sales) {
    revenueByDay.set(
      row.sale_date,
      (revenueByDay.get(row.sale_date) ?? 0) + Number(row.amount),
    );
  }

  const trend: TrendPoint[] = eachDay(from, to).map((date) => ({
    date,
    revenue: revenueByDay.get(date) ?? 0,
    spend: spendByDay.get(date) ?? 0,
  }));

  // --- Сквозная аналитика по креативам -----------------------------------
  const perCreative = new Map<string, PerformanceInput>();
  // Расход в валюте кабинета держим отдельно: в PerformanceInput ему не место,
  // там считаются деньги, и все — в одной валюте.
  const sourceSpend = new Map<string, number>();

  const bucket = (id: string) => {
    let value = perCreative.get(id);
    if (!value) {
      value = { ...emptyPerformance };
      perCreative.set(id, value);
    }
    return value;
  };

  for (const row of metrics) {
    if (!row.creative_id) continue;
    const target = bucket(row.creative_id);
    target.spend += Number(row.spend);
    target.impressions += Number(row.impressions);
    target.clicks += Number(row.clicks);

    if (row.spend_source !== undefined) {
      sourceSpend.set(
        row.creative_id,
        (sourceSpend.get(row.creative_id) ?? 0) + Number(row.spend_source),
      );
    }
  }

  for (const lead of leads) {
    if (!lead.creative_id) continue;
    const target = bucket(lead.creative_id);
    target.leads += 1;
    if (isReached(lead.status)) target.processed += 1;
  }

  for (const trial of trials) {
    if (trial.status !== 'completed' || !trial.lead_id) continue;
    const creativeId = leadToCreative.get(trial.lead_id);
    if (creativeId) bucket(creativeId).trials += 1;
  }

  for (const sale of sales) {
    if (!sale.lead_id) continue;
    const creativeId = leadToCreative.get(sale.lead_id);
    if (!creativeId) continue;
    const target = bucket(creativeId);
    target.sales += 1;
    target.revenue += Number(sale.amount);
  }

  const creativePerformance: CreativePerformance[] = creatives
    // Подпись короткая, как везде: длинное имя из Ads Manager занимает всю
    // строку и ничего не говорит — в отчёте от него никакой пользы.
    .map((creative, index) => {
      const input = perCreative.get(creative.id) ?? emptyPerformance;
      return {
        id: creative.id,
        name: creativeLabel(creative, index + 1),
        platform: creative.platform,
        format: creative.format,
        spendSource: sourceSpend.get(creative.id) ?? null,
        ...summarize(input),
      };
    })
    .filter((creative) => creative.spend > 0 || creative.leads > 0)
    .sort((a, b) => b.revenue - a.revenue);

  // --- Итоги по отделам продаж -------------------------------------------
  const departmentOfLead = new Map(leads.map((lead) => [lead.id, lead.department_id]));

  const departmentTotals: DepartmentTotals[] = splitByDepartment
    ? allDepartments.map((department) => {
        const own = adRowsOfDepartment(metrics, campaignDepartments, department.id);
        const ownSales = sales.filter(
          (sale) => sale.lead_id && departmentOfLead.get(sale.lead_id) === department.id,
        );

        return {
          id: department.id,
          name: department.name,
          spend: sum(own, (row) => Number(row.spend)),
          spendSource: sum(own, (row) => Number(row.spend_source ?? 0)) || null,
          leads: leads.filter((lead) => lead.department_id === department.id).length,
          sales: ownSales.length,
          revenue: sum(ownSales, (row) => Number(row.amount)),
        };
      })
    : [];

  return {
    totals,
    spendSource: sum(metrics, (row) => Number(row.spend_source ?? 0)) || null,
    trend,
    creatives: creativePerformance,
    hasAdData: metrics.length > 0,
    departments: departmentTotals,
  };
}

/** Креативы для выпадающих списков в формах. */
export async function getCreativeOptions(companyId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('creatives')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .order('name');
  return data ?? [];
}

export async function getAdAccounts(companyId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('ad_accounts')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at');
  return data ?? [];
}

/**
 * Заведена ли у компании хоть одна кампания.
 *
 * Раздел «Реклама» спрашивает об этом, чтобы отличить «ничего не подключено»
 * от «подключено, но за период пусто». Выгружать ради такого ответа тысячи
 * строк незачем — да и нельзя: PostgREST отдаёт не больше тысячи за раз.
 */
export async function hasCampaigns(companyId: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('campaigns')
    .select('id')
    .eq('company_id', companyId)
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Короткая подпись креатива.
 *
 * Meta называет объявления как придётся — «Напишите нам», «Новое объявление с
 * целью „Лиды" — Копия». В таблице такое имя занимает пол-экрана и ничего не
 * говорит. Поэтому у каждого ролика есть свой короткий номер, а полное имя из
 * кабинета остаётся на карточке.
 */


export type CreativeCard = {
  id: string;
  name: string;
  /** Короткая подпись: «Видео 3» или своё имя, если задали. */
  label: string;
  /** Заданное имя, если оно есть: нужно форме переименования. */
  rawLabel: string | null;
  title: string | null;
  body: string | null;
  status: string;
  format: string | null;
  platform: string;
  thumbnailUrl: string | null;
  hasVideo: boolean;
  /** В каких кампаниях крутился и на какие номера вёл. */
  campaigns: string[];
  numbers: string[];
  /** Из рекламного кабинета. */
  spend: number;
  /** Тот же расход в валюте кабинета — null, когда валюты совпадают. */
  spendSource: number | null;
  impressions: number;
  clicks: number;
  ctr: number;
  /** Лиды по данным площадки: заявки с сайта плюс начатые переписки. */
  conversions: number;
  /** Пробные занятия и просмотры ролика. */
  trials: number;
  videoPlays: number;
  videoCompletions: number;
  videoAvgSeconds: number;
  costPerConversion: number;
  /** Из CRM: заявки, продажи и деньги, дошедшие до кассы. */
  crmLeads: number;
  sales: number;
  revenue: number;
};

/**
 * Креативы с медиа и цифрами за период.
 *
 * Две группы чисел намеренно не смешиваются: слева то, что говорит рекламный
 * кабинет (расход, клики, написали), справа — что дошло до CRM (заявки,
 * продажи, выручка). Пока CRM пустая, там честные нули, а не пересчёт одного
 * в другое.
 */
export async function getCreativeCards(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
  departmentId?: string | null,
): Promise<CreativeCard[]> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const [
    { data: creatives },
    metricRows,
    leadRows,
    { data: sales },
    { data: trials },
  ] =
    await Promise.all([
      supabase
        .from('creatives')
        .select(
          'id, name, label, title, body, status, format, platform, thumbnail_url, video_id, created_at',
        )
        .eq('company_id', companyId)
        .order('created_at')
        .order('id'),
      selectAll((start, end) =>
        supabase
          .from('ad_metrics')
          .select(
            'creative_id, campaign_id, date, spend, impressions, clicks, leads, conversations, currency, video_plays, video_completions, video_avg_seconds',
          )
          .eq('company_id', companyId)
          .not('creative_id', 'is', null)
          .gte('date', from)
          .lte('date', to)
          .range(start, end),
      ),
      selectAll((start, end) => {
        let query = supabase
          .from('leads')
          .select('id, creative_id')
          .eq('company_id', companyId)
          .not('creative_id', 'is', null)
          .gte('created_at', day.startsAt)
          .lt('created_at', day.endsBefore)
          .range(start, end);

        if (departmentId) query = query.eq('department_id', departmentId);
        return query;
      }),
      supabase
        .from('sales')
        .select('amount, lead_id')
        .eq('company_id', companyId)
        .eq('status', 'paid')
        .gte('sale_date', from)
        .lte('sale_date', to),
      supabase
        .from('trials')
        .select('lead_id, status')
        .eq('company_id', companyId)
        .gte('date', from)
        .lte('date', to),
    ]);

  const creativeOfLead = new Map(leadRows.map((lead) => [lead.id, lead.creative_id]));

  // Срез отдела: продажи и занятия считаем только по его заявкам.
  const ownLeads = new Set(leadRows.map((lead) => lead.id));
  const ofDepartment = <T extends { lead_id: string | null }>(rows: T[]) =>
    departmentId ? rows.filter((row) => row.lead_id && ownLeads.has(row.lead_id)) : rows;

  const campaignRows = await selectAll<{
    id: string;
    name: string;
    whatsapp_number: string | null;
    department_id: string | null;
  }>((start, end) =>
    supabase
      .from('campaigns')
      .select('id, name, whatsapp_number, department_id')
      .eq('company_id', companyId)
      .range(start, end),
  );

  const campaignById = new Map(campaignRows.map((row) => [row.id, row]));
  const placement = new Map<string, { campaigns: Set<string>; numbers: Set<string> }>();

  // Расход приходит в валюте кабинета — приводим к валюте компании, а кампании
  // найма из отчёта убираем.
  const countedRows = await withoutSkippedCampaigns(
    supabase,
    companyId,
    await toCompanyCurrency(supabase, companyId, metricRows),
  );

  // Расход отдела — это расход его кампаний: отдел стоит на кампании, а не на
  // самом ролике, и один ролик может крутиться у обоих отделов.
  const spendRows = departmentId
    ? adRowsOfDepartment(
        countedRows,
        new Map(campaignRows.map((row) => [row.id, row.department_id])),
        departmentId,
      )
    : countedRows;

  const stats = new Map<
    string,
    {
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      crmLeads: number;
      sales: number;
      revenue: number;
      trials: number;
      plays: number;
      completions: number;
      avgSeconds: number;
      /** Расход в валюте кабинета — до пересчёта. */
      spendSource: number;
    }
  >();

  const bucket = (id: string) => {
    let value = stats.get(id);
    if (!value) {
      value = {
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        crmLeads: 0,
        sales: 0,
        revenue: 0,
        trials: 0,
        plays: 0,
        completions: 0,
        avgSeconds: 0,
        spendSource: 0,
      };
      stats.set(id, value);
    }
    return value;
  };

  for (const row of spendRows) {
    if (!row.creative_id) continue;
    const target = bucket(row.creative_id);
    target.spend += Number(row.spend);
    // Без этой строки расход в валюте кабинета оставался нулём, и весь раздел
    // показывал нули: карточки берут суммы именно отсюда.
    target.spendSource += Number(row.spend_source ?? 0);
    target.impressions += Number(row.impressions);
    target.clicks += Number(row.clicks);
    target.conversions += Number(row.leads) + Number(row.conversations ?? 0);
    target.plays += Number(row.video_plays ?? 0);
    target.completions += Number(row.video_completions ?? 0);
    target.avgSeconds = Math.max(target.avgSeconds, Number(row.video_avg_seconds ?? 0));

    const campaign = row.campaign_id ? campaignById.get(row.campaign_id) : null;
    if (campaign) {
      let where = placement.get(row.creative_id);
      if (!where) {
        where = { campaigns: new Set(), numbers: new Set() };
        placement.set(row.creative_id, where);
      }
      where.campaigns.add(campaign.name);
      if (campaign.whatsapp_number) where.numbers.add(campaign.whatsapp_number);
    }
  }

  for (const lead of leadRows) {
    if (lead.creative_id) bucket(lead.creative_id).crmLeads += 1;
  }

  // Пробное занятие — середина воронки: между обращением и покупкой. Считаем
  // по признаку «урок состоялся», а не по одному статусу: занятие, после
  // которого клиент купил или отказался, тоже состоялось.
  for (const trial of ofDepartment(trials ?? [])) {
    const creativeId = trial.lead_id ? creativeOfLead.get(trial.lead_id) : null;
    if (creativeId && wasHeld(trial.status)) bucket(creativeId).trials += 1;
  }

  for (const sale of ofDepartment(sales ?? [])) {
    const creativeId = sale.lead_id ? creativeOfLead.get(sale.lead_id) : null;
    if (!creativeId) continue;
    const target = bucket(creativeId);
    target.sales += 1;
    target.revenue += Number(sale.amount);
  }

  return (creatives ?? [])
    .map((creative, index) => {
      const value = stats.get(creative.id);
      const spend = value?.spend ?? 0;
      const impressions = value?.impressions ?? 0;
      const clicks = value?.clicks ?? 0;
      const conversions = value?.conversions ?? 0;

      return {
        id: creative.id,
        name: creative.name,
        label: creativeLabel(creative, index + 1),
        rawLabel: creative.label,
        title: creative.title,
        body: creative.body,
        status: creative.status,
        format: creative.format,
        platform: creative.platform,
        trials: value?.trials ?? 0,
        videoPlays: value?.plays ?? 0,
        videoCompletions: value?.completions ?? 0,
        videoAvgSeconds: value?.avgSeconds ?? 0,
        thumbnailUrl: creative.thumbnail_url,
        hasVideo: Boolean(creative.video_id),
        campaigns: Array.from(placement.get(creative.id)?.campaigns ?? []),
        numbers: Array.from(placement.get(creative.id)?.numbers ?? []),
        spend,
        spendSource: value?.spendSource || null,
        impressions,
        clicks,
        ctr: impressions ? (clicks / impressions) * 100 : 0,
        conversions,
        costPerConversion: conversions ? spend / conversions : 0,
        crmLeads: value?.crmLeads ?? 0,
        sales: value?.sales ?? 0,
        revenue: value?.revenue ?? 0,
      };
    })
    .sort((a, b) => b.spend - a.spend || b.conversions - a.conversions);
}

export type AdBreakdownRow = {
  /** Учитывается ли кампания в итогах: найм обычно выключают. */
  counted?: boolean;
  /** Продажи и выручка по заявкам этой кампании — из CRM, а не из рекламы. */
  sales?: number;
  revenue?: number;
  /** Выручка ÷ расход. Ноль, пока продаж нет. */
  roas?: number;
  key: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  spend: number;
  /** Тот же расход в валюте кабинета — null, когда валюты совпадают. */
  spendSource: number | null;
  impressions: number;
  clicks: number;
  /** Заявки с сайта и начатые переписки вместе: и то и другое — обращения. */
  conversions: number;
  costPerConversion: number;
  activeDays: number;
};

export type AdBreakdown = {
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    /** Из чего сложились обращения: заполненные формы и начатые переписки. */
    formLeads: number;
    chatLeads: number;
    costPerConversion: number;
    ctr: number;
    cpc: number;
    /**
     * Тот же расход в валюте рекламного кабинета — с ним директор сверяется
     * с Ads Manager. null, когда кабинет и отчёт считают одинаково.
     */
    spendSource: number | null;
    sourceCurrency: string | null;
    /** Из CRM: заполняется, когда продажи начинают отмечать в кабинете. */
    revenue: number;
    sales: number;
    roas: number;
  };
  campaigns: AdBreakdownRow[];
  numbers: AdBreakdownRow[];
  /** Отделы продаж: у каждого свои кампании и свой бюджет. */
  departments: AdBreakdownRow[];
};

/**
 * Расход и результат по кампаниям и по номерам WhatsApp за период.
 *
 * Считаем из ad_metrics — тех же дневных строк, что отдаёт рекламный кабинет.
 * Кампании без единого дня в периоде не показываем: пустая строка в отчёте
 * только мешает искать глазами ту, которая крутится.
 */
/** Названия отделов по списку номеров. */
async function getDepartmentNames(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  ids: string[],
): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from('departments')
    .select('id, name')
    .eq('company_id', companyId)
    .in('id', ids);

  return data ?? [];
}

/** Сколько строк отдаёт PostgREST за один запрос. */
const PAGE_SIZE = 1000;

/**
 * Полная выборка, а не первая тысяча строк.
 *
 * PostgREST обрезает ответ на тысяче и ничем об этом не сообщает: у проекта с
 * двумя с половиной тысячами заявок отчёты честно показывали тысячу и
 * выглядели правдоподобно. Поэтому всё, что растёт вместе с проектом —
 * заявки, дневная статистика, журнал приёма — читаем страницами.
 *
 * Признак конца — неполная страница: значит дальше ничего нет.
 */
async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await page(from, from + PAGE_SIZE - 1);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

/** Сколько номеров помещается в один запрос: длина адреса не безгранична. */
const LOOKUP_CHUNK = 200;

/**
 * Выборка по списку номеров — пачками.
 *
 * Список уезжает в адрес запроса, а он не резиновый: пятьсот заявок дают
 * восемнадцать тысяч символов, и запрос не уходит вовсе. Отказ приходит не от
 * базы, а от самой отправки, и на экране выглядит как пустой раздел —
 * поэтому режем заранее, а не разбираемся по факту.
 */
async function inChunks<T>(
  ids: string[],
  page: (chunk: string[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
    const { data } = await page(ids.slice(start, start + LOOKUP_CHUNK));
    rows.push(...(data ?? []));
  }

  return rows;
}

/** Кампании по списку номеров — пачками, чтобы не упереться в длину адреса. */
async function campaignsByIds(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  ids: string[],
): Promise<
  {
    id: string;
    name: string;
    status: string | null;
    whatsapp_number: string | null;
    counted: boolean | null;
    department_id: string | null;
  }[]
> {
  const rows: Awaited<ReturnType<typeof campaignsByIds>> = [];

  for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
    const { data } = await supabase
      .from('campaigns')
      .select('id, name, status, whatsapp_number, counted, department_id')
      .eq('company_id', companyId)
      .in('id', ids.slice(start, start + LOOKUP_CHUNK));

    rows.push(...((data ?? []) as typeof rows));
  }

  return rows;
}

export async function getAdBreakdown(
  companyId: string,
  from: string,
  to: string,
): Promise<AdBreakdown> {
  const supabase = await createServerSupabase();

  const metrics = await selectAll((start, end) =>
    supabase
      .from('ad_metrics')
      .select('campaign_id, date, spend, impressions, clicks, leads, conversations, currency')
      .eq('company_id', companyId)
      .gte('date', from)
      .lte('date', to)
      .range(start, end),
  );

  // Кампании берём только те, что встретились в цифрах.
  //
  // Раньше выбирались все кампании компании разом, и у крупного кабинета это
  // молча ломалось: PostgREST отдаёт не больше тысячи строк, а кампаний у
  // Дарына за тысячу двести. Нужные в срез не попадали, и таблица показывала
  // «Без названия» вместо имени кампании.
  const campaigns = await campaignsByIds(
    supabase,
    companyId,
    Array.from(
      new Set(
        metrics
          .map((row) => row.campaign_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ),
  );

  const campaignById = new Map(campaigns.map((row) => [row.id, row]));

  // Выручка приходит из CRM: продажа привязана к заявке, заявка знает свою
  // кампанию. Без продаж колонка честно пустует, а не показывает ноль-обман.
  const [leadRows, { data: saleRows }] = await Promise.all([
    selectAll((start, end) =>
      supabase
        .from('leads')
        .select('id, campaign_id')
        .eq('company_id', companyId)
        .not('campaign_id', 'is', null)
        .range(start, end),
    ),
    supabase
      .from('sales')
      .select('amount, lead_id')
      .eq('company_id', companyId)
      .eq('status', 'paid')
      .gte('sale_date', from)
      .lte('sale_date', to),
  ]);

  const campaignOfLead = new Map(
    leadRows.map((row) => [row.id, row.campaign_id as string]),
  );
  const salesByCampaign = new Map<string, { sales: number; revenue: number }>();

  for (const sale of saleRows ?? []) {
    const campaignId = sale.lead_id ? campaignOfLead.get(sale.lead_id) : null;
    if (!campaignId) continue;
    const bucket = salesByCampaign.get(campaignId) ?? { sales: 0, revenue: 0 };
    bucket.sales += 1;
    bucket.revenue += Number(sale.amount);
    salesByCampaign.set(campaignId, bucket);
  }

  // Кампании найма и прочие непродажные в отчёт не идут: иначе цена лида
  // смешивает соискателей с клиентами.
  const skipped = new Set(
    (campaigns ?? []).filter((row) => row.counted === false).map((row) => row.id),
  );
  const converted = await toCompanyCurrency(supabase, companyId, metrics ?? []);
  const spendRows = converted.filter(
    (row) => !row.campaign_id || !skipped.has(row.campaign_id),
  );

  type MetricRow = {
    campaign_id: string | null;
    date: string;
    spend: number;
    /** Расход до пересчёта — есть только когда валюты разные. */
    spend_source?: number;
    impressions: number;
    clicks: number;
    leads: number;
    conversations?: number;
  };

  const empty = () => ({
    spend: 0,
    spendSource: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    days: new Set<string>(),
  });
  type Bucket = ReturnType<typeof empty>;

  const byCampaign = new Map<string, Bucket>();
  const byNumber = new Map<string, Bucket>();
  const byDepartment = new Map<string, Bucket>();

  const add = (map: Map<string, Bucket>, key: string, row: MetricRow) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = empty();
      map.set(key, bucket);
    }
    bucket.spend += Number(row.spend);
    bucket.spendSource += Number(row.spend_source ?? 0);
    bucket.impressions += Number(row.impressions);
    bucket.clicks += Number(row.clicks);
    bucket.conversions += Number(row.leads) + Number(row.conversations ?? 0);
    if (Number(row.spend) > 0) bucket.days.add(row.date);
  };

  // В таблицу кампаний попадают и выключенные — директор должен видеть, что
  // они крутились, и понимать, почему их нет в итогах.
  for (const row of converted) {
    if (row.campaign_id) add(byCampaign, row.campaign_id, row);
  }

  for (const row of spendRows) {
    const campaign = row.campaign_id ? campaignById.get(row.campaign_id) : null;

    const number = campaign?.whatsapp_number;
    if (number) add(byNumber, number, row);

    // Кампания без отдела — общий бюджет проекта; отдельной строкой она в
    // разбивку не идёт, иначе «ничьё» выглядит как ещё один отдел продаж.
    if (campaign?.department_id) add(byDepartment, campaign.department_id, row);
  }

  const toRow = (
    key: string,
    bucket: Bucket,
    title: string,
    subtitle: string | null,
    status: string | null,
  ): AdBreakdownRow => ({
    key,
    title,
    subtitle,
    status,
    spend: bucket.spend,
    spendSource: bucket.spendSource || null,
    impressions: bucket.impressions,
    clicks: bucket.clicks,
    conversions: bucket.conversions,
    costPerConversion: bucket.conversions ? bucket.spend / bucket.conversions : 0,
    activeDays: bucket.days.size,
  });

  const campaignRows = Array.from(byCampaign, ([id, bucket]) => {
    const campaign = campaignById.get(id);
    return {
      ...toRow(
        id,
        bucket,
        campaign?.name ?? 'Без названия',
        campaign?.whatsapp_number ?? null,
        campaign?.status ?? null,
      ),
      counted: campaign?.counted !== false,
      sales: salesByCampaign.get(id)?.sales ?? 0,
      revenue: salesByCampaign.get(id)?.revenue ?? 0,
      roas: bucket.spend ? (salesByCampaign.get(id)?.revenue ?? 0) / bucket.spend : 0,
    };
  }).sort((a, b) => b.spend - a.spend);

  const numberRows = Array.from(byNumber, ([number, bucket]) =>
    toRow(number, bucket, number, null, null),
  ).sort((a, b) => b.spend - a.spend);

  const departmentNames = new Map(
    (await getDepartmentNames(supabase, companyId, Array.from(byDepartment.keys()))).map(
      (row) => [row.id, row.name],
    ),
  );

  const departmentRows = Array.from(byDepartment, ([id, bucket]) =>
    toRow(id, bucket, departmentNames.get(id) ?? 'Без отдела', null, null),
  ).sort((a, b) => b.spend - a.spend);

  // Итоги считаем по тем же пересчитанным строкам, что и разбивку: иначе
  // карточки наверху и таблицы под ними разошлись бы в валюте.
  const spend = sum(spendRows, (row) => Number(row.spend));
  // Расход глазами рекламного кабинета: суммируем то, что было до пересчёта.
  // Складываем только одну валюту: два кабинета в разных валютах в одну сумму
  // не сложить, и тогда честнее показать всё в валюте компании.
  const sourceCurrency =
    spendRows.find((row) => row.spend_source !== undefined)?.currency ?? null;
  const mixed = spendRows.some(
    (row) => row.spend_source !== undefined && row.currency !== sourceCurrency,
  );
  const spendSource = mixed
    ? 0
    : sum(spendRows, (row) => Number(row.spend_source ?? 0));

  const impressions = sum(spendRows, (row) => Number(row.impressions));
  const clicks = sum(spendRows, (row) => Number(row.clicks));
  const conversions = sum(spendRows, (row) => Number(row.leads) + Number(row.conversations ?? 0));
  const formLeads = sum(spendRows, (row) => Number(row.leads));
  const chatLeads = sum(spendRows, (row) => Number(row.conversations ?? 0));

  const revenue = Array.from(salesByCampaign.entries())
    .filter(([id]) => !skipped.has(id))
    .reduce((total, [, bucket]) => total + bucket.revenue, 0);
  const salesCount = Array.from(salesByCampaign.entries())
    .filter(([id]) => !skipped.has(id))
    .reduce((total, [, bucket]) => total + bucket.sales, 0);

  return {
    totals: {
      spend,
      impressions,
      clicks,
      conversions,
      formLeads,
      chatLeads,
      costPerConversion: conversions ? spend / conversions : 0,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      cpc: clicks ? spend / clicks : 0,
      spendSource: spendSource || null,
      sourceCurrency: spendSource ? sourceCurrency : null,
      revenue,
      sales: salesCount,
      roas: spend ? revenue / spend : 0,
    },
    campaigns: campaignRows,
    numbers: numberRows,
    departments: departmentRows,
  };
}

const LIST_LIMIT = 200;

export type LeadListItem = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  platform: string | null;
  status: string;
  created_at: string;
  creativeName: string | null;
  creativeId: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  /** Отдел продаж, которому досталась заявка. */
  departmentName: string | null;
  /** Сумма оплаченной продажи, если чек уже проведён. */
  saleAmount: number | null;
  /**
   * Последний урок этой заявки — работа продажника.
   *
   * Рядом со статусом заявки намеренно: «Думает» и «Отказ» есть у обоих, но
   * означают разное — у менеджера до урока, у продажника после. В одну
   * колонку их не свести, не потеряв, кто и на каком шаге так решил.
   */
  trialStatus: string | null;
  trialSellerName: string | null;
};

export type LeadStats = {
  total: number;
  attributed: number;
  reached: number;
  won: number;
  untouched: number;
  counts: Record<string, number>;
};

/**
 * Сводка по лидам за период. Считается отдельным запросом, а не по видимым
 * строкам: таблица показывает последние 200, а плитки обязаны отвечать за
 * весь период — иначе директор увидит заниженные цифры и не заметит подмены.
 */
export async function getLeadStats(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
  departmentId?: string | null,
): Promise<LeadStats> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const leads = await selectAll((start, end) => {
    const query = supabase
      .from('leads')
      .select('status, created_at, creative_id')
      .eq('company_id', companyId)
      .gte('created_at', day.startsAt)
      .lt('created_at', day.endsBefore)
      .range(start, end);

    return departmentId ? query.eq('department_id', departmentId) : query;
  });
  const counts: Record<string, number> = {};
  for (const lead of leads) counts[lead.status] = (counts[lead.status] ?? 0) + 1;

  return {
    total: leads.length,
    attributed: leads.filter((lead) => lead.creative_id).length,
    reached: leads.filter((lead) => isReached(lead.status)).length,
    won: leads.filter((lead) => leadStage(lead.status) === 'won').length,
    untouched: countUntouched(leads),
    counts,
  };
}

/** Сколько заявок на странице по умолчанию и какие варианты предлагаем. */
export const LEADS_PER_PAGE = 100;
export const LEADS_PER_PAGE_OPTIONS = [20, 50, 100];

export type LeadPage = {
  items: LeadListItem[];
  /** Сколько заявок в периоде всего — по нему считаются страницы. */
  total: number;
};

export async function getLeads(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
  departmentId?: string | null,
  page = 1,
  perPage = LEADS_PER_PAGE,
): Promise<LeadPage> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  // Сначала — сколько заявок в периоде всего, отдельным запросом.
  //
  // База на просьбу выдать строки за последней страницей отвечает отказом, а
  // не пустым списком, и тогда раздел пропадал целиком: номер страницы висит
  // в адресе с прошлого раза, а после смены периода или отдела заявок стало
  // меньше. Зная итог, номер прижимаем к последней существующей странице —
  // человек видит конец списка, а не пустоту.
  //
  // Итог берём обычным запросом на одну строку, а не «пустым» HEAD: число
  // приезжает в заголовке ответа, и по дороге до браузера заголовок иногда
  // теряется. Тогда счётчик приходит пустым, страниц выходит одна, и кнопки
  // перелистывания пропадают при полной таблице на экране. Если счётчика
  // всё-таки нет — пересчитываем заявки построчно.
  let countQuery = supabase
    .from('leads')
    .select('id', { count: 'exact' })
    .eq('company_id', companyId)
    .gte('created_at', day.startsAt)
    .lt('created_at', day.endsBefore)
    .limit(1);

  if (departmentId) countQuery = countQuery.eq('department_id', departmentId);

  const { count } = await countQuery;
  const total =
    count ??
    (
      await selectAll<{ id: string }>((chunkFrom, chunkTo) => {
        let query = supabase
          .from('leads')
          .select('id')
          .eq('company_id', companyId)
          .gte('created_at', day.startsAt)
          .lt('created_at', day.endsBefore)
          .range(chunkFrom, chunkTo);
        if (departmentId) query = query.eq('department_id', departmentId);
        return query;
      })
    ).length;

  // Страницу считаем от единицы: она приходит из адреса, и «?page=0» там
  // выглядел бы опечаткой, а не первой страницей.
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const start = (Math.min(Math.max(1, page), lastPage) - 1) * perPage;

  let leadQuery = supabase
    .from('leads')
    .select(
      'id, name, phone, source, platform, status, created_at, creative_id, assigned_to, department_id',
    )
    .eq('company_id', companyId)
    .gte('created_at', day.startsAt)
    .lt('created_at', day.endsBefore)
    .order('created_at', { ascending: false })
    .range(start, start + perPage - 1);

  if (departmentId) leadQuery = leadQuery.eq('department_id', departmentId);

  const [{ data: leads }, { data: creatives }, { data: employees }, { data: departments }] =
    await Promise.all([
      leadQuery,
      supabase
        .from('creatives')
        .select('id, name, label, format, created_at')
        .eq('company_id', companyId)
        .order('created_at')
        .order('id'),
      supabase.from('employees').select('id, full_name').eq('company_id', companyId),
      supabase.from('departments').select('id, name').eq('company_id', companyId),
    ]);

  const creativeNames = new Map(
    (creatives ?? []).map((row, index) => [row.id, creativeLabel(row, index + 1)]),
  );
  const employeeNames = new Map((employees ?? []).map((row) => [row.id, row.full_name]));
  const departmentNames = new Map((departments ?? []).map((row) => [row.id, row.name]));

  // Продажи по этим заявкам: чек мог быть проведён продажником в боте, и
  // тогда предлагать «оформить продажу» второй раз нельзя — так и появляются
  // задвоенные суммы в отчёте.
  const leadIds = (leads ?? []).map((lead) => lead.id);
  const sales = await inChunks(leadIds, (chunk) =>
    supabase
      .from('sales')
      .select('lead_id, amount')
      .eq('company_id', companyId)
      .eq('status', 'paid')
      .in('lead_id', chunk),
  );

  const saleByLead = new Map<string, number>();
  for (const sale of sales) {
    if (!sale.lead_id) continue;
    saleByLead.set(sale.lead_id, (saleByLead.get(sale.lead_id) ?? 0) + Number(sale.amount));
  }

  // Уроки этих заявок. Берём последний по каждой: клиента, не вышедшего на
  // связь, записывают заново, и показывать надо текущую попытку.
  const trials = await inChunks(leadIds, (chunk) =>
    supabase
      .from('trials')
      .select('lead_id, status, assigned_to, created_at')
      .eq('company_id', companyId)
      .in('lead_id', chunk)
      .order('created_at', { ascending: false }),
  );

  const trialByLead = new Map<string, { status: string; assigned_to: string | null }>();
  for (const trial of trials) {
    if (!trial.lead_id || trialByLead.has(trial.lead_id)) continue;
    trialByLead.set(trial.lead_id, { status: trial.status, assigned_to: trial.assigned_to });
  }

  const items = (leads ?? []).map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    source: lead.source,
    platform: lead.platform,
    status: lead.status,
    created_at: lead.created_at,
    creativeName: lead.creative_id ? (creativeNames.get(lead.creative_id) ?? null) : null,
    creativeId: lead.creative_id ?? null,
    assignedTo: lead.assigned_to,
    assignedName: lead.assigned_to ? (employeeNames.get(lead.assigned_to) ?? null) : null,
    departmentName: lead.department_id ? (departmentNames.get(lead.department_id) ?? null) : null,
    saleAmount: saleByLead.get(lead.id) ?? null,
    trialStatus: trialByLead.get(lead.id)?.status ?? null,
    trialSellerName: (() => {
      const sellerId = trialByLead.get(lead.id)?.assigned_to;
      return sellerId ? (employeeNames.get(sellerId) ?? null) : null;
    })(),
  }));

  return { items, total };
}

/**
 * Найденный клиент — вся его история в одной карточке.
 *
 * Отдельный тип, а не LeadListItem: в списке за период нужна строка таблицы,
 * а здесь человек ищет конкретного клиента и хочет увидеть про него всё
 * сразу — откуда пришёл, кто с ним работал, был ли на встрече, сколько
 * заплатил.
 */
export type ClientMatch = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  createdAt: string;
  source: string | null;
  platform: string | null;
  creativeName: string | null;
  assignedName: string | null;
  departmentName: string | null;
  /** Записи на промежуточный шаг воронки: когда и чем закончились. */
  visits: { id: string; date: string; status: string; sellerName: string | null }[];
  /** Оплаченные продажи. Отменённые и возвращённые тоже видны — это история. */
  purchases: { id: string; date: string; amount: number; product: string | null; status: string }[];
  /** Сколько клиент заплатил всего: только оплаченные чеки. */
  totalPaid: number;
  touchCount: number;
  lastTouchAt: string | null;
  nextTouchAt: string | null;
  /** Переписка WhatsApp, если клиент пришёл туда. Свежие снизу. */
  messages: {
    id: string;
    direction: 'in' | 'out';
    body: string | null;
    type: string;
    status: string;
    sentAt: string;
  }[];
  /** Сколько раз человек переходил по рекламе до этого разговора. */
  clickCount: number;
};

/** Больше этого числа совпадений не показываем: значит запрос слишком общий. */
export const SEARCH_LIMIT = 20;

/** Сколько последних сообщений показываем в карточке клиента. */
const MESSAGE_TAIL = 12;

/**
 * Поиск клиента по номеру телефона или имени.
 *
 * Ищет по ВСЕЙ истории, а не за выбранный период, и это главное: человека
 * ищут именно тогда, когда он позвонил сам, — а пришёл он мог полгода назад,
 * и в фильтре «последние 7 дней» его нет.
 *
 * Номер сравниваем одними цифрами: в базе он записан то с пробелами, то
 * скобками, а в поиске набирают как помнят. Достаточно любой части номера.
 *
 * Что именно найдётся, решает RLS: директор видит всех клиентов компании,
 * менеджер — только своих.
 */
export async function searchClients(
  companyId: string,
  query: string,
): Promise<ClientMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const supabase = await createServerSupabase();

  const digits = trimmed.replace(/\D/g, '');
  // Часть номера — если цифр набрали достаточно, чтобы это был не просто год
  // в имени. Иначе ищем только по имени.
  const byPhone = digits.length >= 4 ? `phone_digits.like.*${digits}*` : null;
  const byName = `name.ilike.*${escapeFilterValue(trimmed)}*`;

  const { data: leads } = await supabase
    .from('leads')
    .select(
      'id, name, phone, email, source, platform, status, created_at, creative_id, assigned_to, department_id, touch_count, last_touch_at, next_touch_at',
    )
    .eq('company_id', companyId)
    .or([byPhone, byName].filter(Boolean).join(','))
    .order('created_at', { ascending: false })
    .limit(SEARCH_LIMIT);

  if (!leads || leads.length === 0) return [];

  const leadIds = leads.map((lead) => lead.id);

  const [
    { data: creatives },
    { data: employees },
    { data: departments },
    { data: visits },
    { data: purchases },
    { data: messages },
    { data: clicks },
  ] = await Promise.all([
      supabase
        .from('creatives')
        .select('id, name, label, format, created_at')
        .eq('company_id', companyId)
        .order('created_at')
        .order('id'),
      supabase.from('employees').select('id, full_name').eq('company_id', companyId),
      supabase.from('departments').select('id, name').eq('company_id', companyId),
      supabase
        .from('trials')
        .select('id, lead_id, date, status, assigned_to')
        .eq('company_id', companyId)
        .in('lead_id', leadIds)
        .order('date', { ascending: false }),
      supabase
        .from('sales')
        .select('id, lead_id, sale_date, amount, product, status')
        .eq('company_id', companyId)
        .in('lead_id', leadIds)
        .order('sale_date', { ascending: false }),
      // Переписка: показываем свежий хвост, а не всю историю — менеджеру перед
      // звонком нужен последний разговор, а не переписка полугодовой давности.
      supabase
        .from('whatsapp_messages')
        .select('id, lead_id, direction, body, type, status, sent_at')
        .eq('company_id', companyId)
        .in('lead_id', leadIds)
        .order('sent_at', { ascending: false })
        .limit(MESSAGE_TAIL * SEARCH_LIMIT),
      supabase
        .from('lead_clicks')
        .select('lead_id')
        .eq('company_id', companyId)
        .in('lead_id', leadIds),
    ]);

  const creativeNames = new Map(
    (creatives ?? []).map((row, index) => [row.id, creativeLabel(row, index + 1)]),
  );
  const employeeNames = new Map((employees ?? []).map((row) => [row.id, row.full_name]));
  const departmentNames = new Map((departments ?? []).map((row) => [row.id, row.name]));

  return leads.map((lead) => {
    const leadVisits = (visits ?? []).filter((row) => row.lead_id === lead.id);
    const leadPurchases = (purchases ?? []).filter((row) => row.lead_id === lead.id);

    return {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      status: lead.status,
      createdAt: lead.created_at,
      source: lead.source,
      platform: lead.platform,
      creativeName: lead.creative_id ? (creativeNames.get(lead.creative_id) ?? null) : null,
      assignedName: lead.assigned_to ? (employeeNames.get(lead.assigned_to) ?? null) : null,
      departmentName: lead.department_id
        ? (departmentNames.get(lead.department_id) ?? null)
        : null,
      visits: leadVisits.map((row) => ({
        id: row.id,
        date: row.date,
        status: row.status,
        sellerName: row.assigned_to ? (employeeNames.get(row.assigned_to) ?? null) : null,
      })),
      purchases: leadPurchases.map((row) => ({
        id: row.id,
        date: row.sale_date,
        amount: Number(row.amount),
        product: row.product,
        status: row.status,
      })),
      totalPaid: leadPurchases
        .filter((row) => row.status === 'paid')
        .reduce((sum, row) => sum + Number(row.amount), 0),
      touchCount: lead.touch_count ?? 0,
      lastTouchAt: lead.last_touch_at,
      nextTouchAt: lead.next_touch_at,
      // Из базы пришли новые сверху — разворачиваем, чтобы читалось как чат.
      messages: (messages ?? [])
        .filter((row) => row.lead_id === lead.id)
        .slice(0, MESSAGE_TAIL)
        .reverse()
        .map((row) => ({
          id: row.id,
          direction: row.direction,
          body: row.body,
          type: row.type,
          status: row.status,
          sentAt: row.sent_at,
        })),
      clickCount: (clicks ?? []).filter((row) => row.lead_id === lead.id).length,
    };
  });
}

/**
 * Экранирование значения для фильтра PostgREST.
 *
 * В `or(...)` запятая и скобки разделяют условия, поэтому имя вроде
 * «Иванов, А.» разорвало бы запрос на части. Кавычки внутри тоже опасны.
 */
function escapeFilterValue(value: string): string {
  return value.replace(/[,()"\\]/g, ' ');
}

/**
 * Сколько заявок лежит без ответственного прямо сейчас.
 *
 * Считается вне выбранного периода: ночная очередь — это то, что скопилось,
 * пока никого не было на смене, и её надо видеть в любом фильтре дат.
 */
export async function countUnassignedLeads(companyId: string): Promise<number> {
  const supabase = await createServerSupabase();

  const { count } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('assigned_to', null)
    .in('status', ['new', 'no_answer', 'thinking']);

  return count ?? 0;
}

export type TeamMember = {
  id: string;
  fullName: string;
  role: string;
  phone: string | null;
  status: string;
  hiredAt: string;
  firedAt: string | null;
  telegramUsername: string | null;
  telegramLinked: boolean;
  /** Есть ли у сотрудника вход в кабинет. */
  hasLogin: boolean;
  loginEmail: string | null;
  /** Открыта ли смена прямо сейчас — только такие получают лиды. */
  onShift: boolean;
  shiftStartedAt: string | null;
  /** Личные правила смены: null означает «как в компании». */
  shiftMode: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  workDays: number[] | null;
  lateGraceMinutes: number | null;
  rules: ShiftRules;
  /** Показатели за выбранный период. */
  leads: number;
  reached: number;
  won: number;
  revenue: number;
};

/**
 * Команда компании с показателями за период.
 *
 * Уволенные не исчезают: их лиды и продажи остались в отчётах прошлых месяцев,
 * поэтому строка сохраняется со статусом «уволен».
 */
export async function getTeam(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
): Promise<TeamMember[]> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const { data: companyRow } = await supabase
    .from('companies')
    .select('shift_mode, work_start_time, work_end_time, work_days, late_grace_minutes')
    .eq('id', companyId)
    .maybeSingle();

  const companyRules = companyRow ?? {
    shift_mode: 'shift',
    work_start_time: '09:00',
    work_end_time: '18:00',
    work_days: [1, 2, 3, 4, 5],
    late_grace_minutes: 10,
  };

  const [{ data: employees }, leadRows, { data: sales }, { data: openShifts }] =
    await Promise.all([
    supabase
      .from('employees')
      .select('*')
      .eq('company_id', companyId)
      .order('status')
      .order('full_name'),
    selectAll((start, end) =>
      supabase
        .from('leads')
        .select('id, status, assigned_to')
        .eq('company_id', companyId)
        .not('assigned_to', 'is', null)
        .gte('created_at', day.startsAt)
        .lt('created_at', day.endsBefore)
        .range(start, end),
    ),
    supabase
      .from('sales')
      .select('amount, lead_id, seller_id')
      .eq('company_id', companyId)
      .eq('status', 'paid')
      .gte('sale_date', from)
      .lte('sale_date', to),
    supabase
      .from('shifts')
      .select('employee_id, started_at')
      .eq('company_id', companyId)
      .is('ended_at', null),
  ]);

  const shiftOf = new Map(
    (openShifts ?? []).map((shift) => [shift.employee_id, shift.started_at]),
  );

  // Выручка идёт тому, кто записан продавцом в самой продаже. Старые продажи,
  // где его нет, считаем по-прежнему — через клиента.
  const leadOwner = new Map(leadRows.map((lead) => [lead.id, lead.assigned_to]));

  const stats = new Map<string, TeamStats>();
  const bucket = (id: string) => {
    let value = stats.get(id);
    if (!value) {
      value = { ...EMPTY_TEAM_STATS };
      stats.set(id, value);
    }
    return value;
  };

  for (const lead of leadRows) {
    if (!lead.assigned_to) continue;
    const target = bucket(lead.assigned_to);
    target.leads += 1;
    if (isReached(lead.status)) target.reached += 1;
    if (leadStage(lead.status) === 'won') target.won += 1;
  }

  for (const sale of sales ?? []) {
    const ownerId =
      sale.seller_id ?? (sale.lead_id ? leadOwner.get(sale.lead_id) : null);
    if (ownerId) bucket(ownerId).revenue += Number(sale.amount);
  }

  // Почта входа лежит в profiles, а карточка сотрудника ссылается туда.
  const profileIds = (employees ?? [])
    .map((employee) => employee.profile_id)
    .filter((id): id is string => id !== null);

  const { data: logins } = profileIds.length
    ? await supabase.from('profiles').select('id, email').in('id', profileIds)
    : { data: [] as { id: string; email: string | null }[] };

  const loginEmails = new Map((logins ?? []).map((row) => [row.id, row.email]));

  return (employees ?? []).map((employee) => {
    const value = stats.get(employee.id) ?? EMPTY_TEAM_STATS;
    return {
      id: employee.id,
      fullName: employee.full_name,
      role: employee.role,
      phone: employee.phone,
      status: employee.status,
      hiredAt: employee.hired_at,
      firedAt: employee.fired_at,
      telegramUsername: employee.telegram_username,
      telegramLinked: employee.telegram_user_id !== null,
      hasLogin: employee.profile_id !== null,
      loginEmail: employee.profile_id
        ? (loginEmails.get(employee.profile_id) ?? null)
        : null,
      onShift: shiftOf.has(employee.id),
      shiftStartedAt: shiftOf.get(employee.id) ?? null,
      shiftMode: employee.shift_mode,
      workStartTime: employee.work_start_time,
      workEndTime: employee.work_end_time,
      workDays: employee.work_days,
      lateGraceMinutes: employee.late_grace_minutes,
      rules: resolveShiftRules(employee, companyRules),
      ...value,
    };
  });
}

type TeamStats = { leads: number; reached: number; won: number; revenue: number };

const EMPTY_TEAM_STATS: TeamStats = { leads: 0, reached: 0, won: 0, revenue: 0 };

/** Активные сотрудники для выпадающих списков назначения. */
export async function getAssignableEmployees(companyId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('employees')
    .select('id, full_name, role')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .order('full_name');
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.full_name,
    role: row.role,
  }));
}

export type TrialListItem = {
  id: string;
  date: string;
  status: string;
  amount: number;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  /** Продажник, который проводит урок. */
  sellerName: string | null;
  /** Точное начало урока: онлайн важен час, а не только день. */
  startsAt: string | null;
  /** Сумма проведённого чека по этому клиенту. null — продажи ещё нет. */
  saleAmount: number | null;
  /** Когда менеджер продал урок и записал клиента. */
  createdAt: string;
};

/** Строка запроса уроков: связь с заявкой нужна только для фильтра. */
type TrialQueryRow = {
  id: string;
  date: string;
  status: string;
  amount: number | string;
  lead_id: string | null;
  assigned_to: string | null;
  starts_at: string | null;
  created_at: string;
};

/**
 * По какому дню отбирать уроки.
 *
 * У продажника и менеджера это разные дни, и подменять один другим нельзя:
 *   • `lesson` — день занятия. Продажник смотрит расписание: что у него
 *     сегодня, что в понедельник.
 *   • `sold` — день, когда менеджер продал урок. Он записал сегодня девятнадцать
 *     человек, а занятия у них на всю неделю вперёд; по дню занятия его работа
 *     за сегодня показала бы три записи из девятнадцати.
 */
export type TrialBasis = 'lesson' | 'sold';

export async function getTrials(
  companyId: string,
  from: string,
  to: string,
  options?: {
    timeZone?: string;
    basis?: TrialBasis;
    /** Только уроки, проданные этим менеджером (его заявки). */
    managerId?: string | null;
    /** Только уроки, которые ведёт этот продажник. */
    sellerId?: string | null;
  },
): Promise<TrialListItem[]> {
  const supabase = await createServerSupabase();

  const columns = 'id, date, status, amount, lead_id, assigned_to, starts_at, created_at';

  // Связь с заявкой добавляем только когда по ней фильтруем: `!inner`
  // выбросил бы уроки без клиента, а они бывают у старых записей.
  let query = supabase
    .from('trials')
    .select(options?.managerId ? `${columns}, leads!inner(assigned_to)` : columns)
    .eq('company_id', companyId);

  if (options?.managerId) query = query.eq('leads.assigned_to', options.managerId);
  if (options?.sellerId) query = query.eq('assigned_to', options.sellerId);

  if (options?.basis === 'sold') {
    const window = zonedDayWindow(from, to, options.timeZone ?? 'Asia/Almaty');
    query = query
      .gte('created_at', window.startsAt)
      .lt('created_at', window.endsBefore)
      .order('created_at', { ascending: false });
  } else {
    query = query.gte('date', from).lte('date', to).order('date', { ascending: false });
  }

  const { data } = await query.limit(LIST_LIMIT);
  const trials = (data ?? []) as unknown as TrialQueryRow[];

  const leadIds = [...new Set(trials.map((row) => row.lead_id).filter(Boolean))] as string[];

  const [leads, { data: employees }, sales] = await Promise.all([
    fetchLeadContacts(companyId, trials),
    supabase.from('employees').select('id, full_name').eq('company_id', companyId),
    // Чек мог провести бот — тогда сумму спрашивать во второй раз нельзя.
    inChunks(leadIds, (chunk) =>
      supabase
        .from('sales')
        .select('lead_id, amount')
        .eq('company_id', companyId)
        .eq('status', 'paid')
        .in('lead_id', chunk),
    ),
  ]);

  const sellerNames = new Map((employees ?? []).map((row) => [row.id, row.full_name]));
  const paidByLead = new Map(
    sales
      .filter((row) => row.lead_id)
      .map((row) => [row.lead_id as string, Number(row.amount)]),
  );

  return trials.map((trial) => ({
    id: trial.id,
    date: trial.date,
    createdAt: trial.created_at,
    status: trial.status,
    amount: Number(trial.amount),
    leadId: trial.lead_id,
    leadName: trial.lead_id ? (leads.get(trial.lead_id)?.name ?? null) : null,
    leadPhone: trial.lead_id ? (leads.get(trial.lead_id)?.phone ?? null) : null,
    sellerName: trial.assigned_to ? (sellerNames.get(trial.assigned_to) ?? null) : null,
    startsAt: trial.starts_at,
    saleAmount: trial.lead_id ? (paidByLead.get(trial.lead_id) ?? null) : null,
  }));
}

/** Покупатель, пришедший с одного ролика. */
export type CreativeBuyer = {
  saleId: string;
  leadId: string | null;
  name: string;
  phone: string | null;
  amount: number;
  saleDate: string;
  /** Когда человек оставил заявку — видно, сколько думал до покупки. */
  leadDate: string | null;
};

/**
 * Кто купил с этого ролика за период.
 *
 * Правило то же, по которому в карточке ролика считаются продажи и выручка:
 * заявка пришла в этом периоде и с этого ролика, оплата прошла в этом же
 * периоде. Иначе список и цифра над ним расходились бы, а объяснить это
 * человеку невозможно.
 */
export async function getCreativeBuyers(
  companyId: string,
  creativeId: string,
  from: string,
  to: string,
  timeZone: string,
): Promise<CreativeBuyer[]> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const leads = await selectAll<{
    id: string;
    name: string;
    phone: string | null;
    created_at: string;
  }>((start, end) =>
    supabase
      .from('leads')
      .select('id, name, phone, created_at')
      .eq('company_id', companyId)
      .eq('creative_id', creativeId)
      .gte('created_at', day.startsAt)
      .lt('created_at', day.endsBefore)
      .range(start, end),
  );

  if (leads.length === 0) return [];

  const leadById = new Map(leads.map((lead) => [lead.id, lead]));

  const sales = await inChunks(
    leads.map((lead) => lead.id),
    (chunk) =>
      supabase
        .from('sales')
        .select('id, lead_id, amount, sale_date')
        .eq('company_id', companyId)
        .eq('status', 'paid')
        .gte('sale_date', from)
        .lte('sale_date', to)
        .in('lead_id', chunk),
  );

  return sales
    .map((sale) => {
      const lead = sale.lead_id ? leadById.get(sale.lead_id) : undefined;

      return {
        saleId: sale.id,
        leadId: sale.lead_id,
        name: lead?.name || 'Без имени',
        phone: lead?.phone ?? null,
        amount: Number(sale.amount),
        saleDate: sale.sale_date,
        leadDate: lead?.created_at ?? null,
      };
    })
    .sort((a, b) => b.saleDate.localeCompare(a.saleDate) || b.amount - a.amount);
}

export type SaleListItem = {
  id: string;
  sale_date: string;
  product: string | null;
  amount: number;
  status: string;
  leadName: string | null;
  leadPhone: string | null;
  /** С какого ролика пришёл покупатель — ради этой связи и строилась платформа. */
  creativeId: string | null;
  creativeName: string | null;
  /** Отдел продаж, если у проекта их несколько. */
  departmentName: string | null;
};

export async function getSales(
  companyId: string,
  from: string,
  to: string,
  departmentId?: string | null,
): Promise<SaleListItem[]> {
  const supabase = await createServerSupabase();

  const { data: sales } = await supabase
    .from('sales')
    .select('id, sale_date, product, amount, status, lead_id')
    .eq('company_id', companyId)
    .gte('sale_date', from)
    .lte('sale_date', to)
    .order('sale_date', { ascending: false })
    .limit(LIST_LIMIT);

  const [leads, { data: creatives }, { data: departments }] = await Promise.all([
    fetchLeadContacts(companyId, sales ?? []),
    // Порядок тот же, что везде: номер в подписи «Видео 7» — это место в списке.
    supabase
      .from('creatives')
      .select('id, name, label, format, created_at')
      .eq('company_id', companyId)
      .order('created_at')
      .order('id'),
    supabase.from('departments').select('id, name').eq('company_id', companyId),
  ]);

  const creativeNames = new Map(
    (creatives ?? []).map((row, index) => [row.id, creativeLabel(row, index + 1)]),
  );
  const departmentNames = new Map((departments ?? []).map((row) => [row.id, row.name]));

  // Отдел у продажи берётся с её заявки: в самой продаже отдела нет. Продажу
  // без заявки в срез отдела не показываем — чья она, неизвестно.
  const ofDepartment = (sale: { lead_id: string | null }) =>
    !departmentId ||
    (sale.lead_id ? leads.get(sale.lead_id)?.departmentId === departmentId : false);

  return (sales ?? []).filter(ofDepartment).map((sale) => {
    const lead = sale.lead_id ? leads.get(sale.lead_id) : undefined;

    return {
      id: sale.id,
      sale_date: sale.sale_date,
      product: sale.product,
      amount: Number(sale.amount),
      status: sale.status,
      leadName: lead?.name ?? null,
      leadPhone: lead?.phone ?? null,
      creativeId: lead?.creativeId ?? null,
      creativeName: lead?.creativeId ? (creativeNames.get(lead.creativeId) ?? null) : null,
      departmentName: lead?.departmentId
        ? (departmentNames.get(lead.departmentId) ?? null)
        : null,
    };
  });
}

export type ReturnListItem = {
  id: string;
  createdAt: string;
  amount: number;
  reason: string | null;
  processedBy: string | null;
  saleAmount: number;
  product: string | null;
  saleDate: string;
  leadName: string | null;
};

/**
 * Возвраты за период.
 *
 * Дата возврата — когда деньги вернули, а не когда продали: в отчёт месяца
 * попадает возврат прошлогодней продажи, если оформили его в этом месяце.
 */
export async function getReturns(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
): Promise<ReturnListItem[]> {
  const supabase = await createServerSupabase();
  const { startsAt, endsBefore } = zonedDayWindow(from, to, timeZone);

  const { data: rows } = await supabase
    .from('returns')
    .select('id, created_at, amount, reason, processed_by, sale_id')
    .eq('company_id', companyId)
    .gte('created_at', startsAt)
    .lt('created_at', endsBefore)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);

  if (!rows || rows.length === 0) return [];

  const saleIds = [...new Set(rows.map((row) => row.sale_id))];
  const staffIds = [...new Set(rows.map((row) => row.processed_by).filter(Boolean))] as string[];

  const [sales, { data: staff }] = await Promise.all([
    inChunks(saleIds, (chunk) =>
      supabase
        .from('sales')
        .select('id, amount, product, sale_date, lead_id')
        .eq('company_id', companyId)
        .in('id', chunk),
    ),
    staffIds.length
      ? supabase.from('employees').select('id, full_name').in('id', staffIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const staffById = new Map((staff ?? []).map((row) => [row.id, row.full_name]));
  const leads = await fetchLeadContacts(companyId, sales ?? []);

  return rows.map((row) => {
    const sale = saleById.get(row.sale_id);
    return {
      id: row.id,
      createdAt: row.created_at,
      amount: Number(row.amount),
      reason: row.reason,
      // Пусто означает «оформил директор»: карточки сотрудника у него нет.
      processedBy: row.processed_by ? (staffById.get(row.processed_by) ?? null) : null,
      saleAmount: sale ? Number(sale.amount) : 0,
      product: sale?.product ?? null,
      saleDate: sale?.sale_date ?? row.created_at.slice(0, 10),
      leadName: sale?.lead_id ? (leads.get(sale.lead_id)?.name ?? null) : null,
    };
  });
}

/** Кто такой лид: имя, телефон, ролик и отдел — всё, чем его подписывают. */
export type LeadContact = {
  name: string;
  phone: string | null;
  creativeId: string | null;
  departmentId: string | null;
};

/** Контакты лидов, на которые ссылаются переданные записи. */
async function fetchLeadContacts(
  companyId: string,
  rows: { lead_id: string | null }[],
): Promise<Map<string, LeadContact>> {
  const ids = [...new Set(rows.map((row) => row.lead_id).filter(Boolean))] as string[];
  if (ids.length === 0) return new Map();

  const supabase = await createServerSupabase();
  const contacts = new Map<string, LeadContact>();

  // Пачками: и длина адреса запроса не безгранична, и ответ обрезается на
  // тысяче строк — список продаж за большой период легко переваливает за неё.
  for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
    const { data } = await supabase
      .from('leads')
      .select('id, name, phone, creative_id, department_id')
      .eq('company_id', companyId)
      .in('id', ids.slice(start, start + LOOKUP_CHUNK));

    for (const lead of data ?? []) {
      contacts.set(lead.id, {
        name: lead.name,
        phone: lead.phone,
        creativeId: lead.creative_id ?? null,
        departmentId: lead.department_id ?? null,
      });
    }
  }

  return contacts;
}

export async function getReceipts(companyId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('receipts')
    .select('id, amount, phone, receipt_date, verification_status, source, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);
  return data ?? [];
}

export async function getIntegrations(companyId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('integrations')
    .select('*')
    .eq('company_id', companyId);
  return data ?? [];
}

/** Отдел продаж компании. */
/** Группа Telegram и её расписание отчётов — для настроек проекта. */
export type ReportSettings = {
  chats: { id: string; title: string | null; chatId: number }[];
  schedules: {
    id: string;
    chatId: string;
    chatTitle: string;
    sendAt: string;
    period: string;
    sections: string[];
    sentToday: boolean;
  }[];
};

export async function getReportSettings(
  companyId: string,
  timeZone: string,
): Promise<ReportSettings> {
  const supabase = await createServerSupabase();

  const [{ data: chats }, { data: schedules }] = await Promise.all([
    supabase
      .from('report_chats')
      .select('id, title, chat_id')
      .eq('company_id', companyId)
      .order('created_at'),
    supabase
      .from('report_schedules')
      .select('id, chat_id, send_at, period, sections')
      .eq('company_id', companyId)
      .order('send_at'),
  ]);

  // Отметка «сегодня уже отправлен» — чтобы было видно, что расписание живое,
  // а не просто записано.
  const today = zonedIsoDate(new Date(), timeZone);
  const ids = (schedules ?? []).map((row) => row.id);

  const { data: deliveries } = ids.length
    ? await supabase
        .from('report_deliveries')
        .select('schedule_id')
        .eq('date', today)
        .in('schedule_id', ids)
    : { data: [] };

  const sent = new Set((deliveries ?? []).map((row) => row.schedule_id));
  const titles = new Map(
    (chats ?? []).map((row) => [row.id, row.title || `Группа ${row.chat_id}`]),
  );

  return {
    chats: (chats ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      chatId: row.chat_id,
    })),
    schedules: (schedules ?? []).map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      chatTitle: titles.get(row.chat_id) ?? 'Группа',
      sendAt: row.send_at,
      period: row.period,
      sections: row.sections,
      sentToday: sent.has(row.id),
    })),
  };
}

export type DepartmentItem = {
  id: string;
  name: string;
  status: string;
};

export async function getDepartments(companyId: string): Promise<DepartmentItem[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('departments')
    .select('id, name, status')
    .eq('company_id', companyId)
    .order('name');
  return data ?? [];
}

/** Поток заявок: свой адрес приёма, свой отдел, своя площадка. */
export type LeadSourceItem = {
  id: string;
  name: string;
  platform: string;
  status: string;
  webhookKey: string;
  departmentId: string | null;
  departmentName: string | null;
};

export async function getLeadSources(companyId: string): Promise<LeadSourceItem[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('lead_sources')
    .select('id, name, platform, status, webhook_key, department_id, departments(name)')
    .eq('company_id', companyId)
    .order('name');

  return (data ?? []).map((row) => {
    const department = Array.isArray(row.departments) ? row.departments[0] : row.departments;
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      status: row.status,
      webhookKey: row.webhook_key,
      departmentId: row.department_id,
      departmentName: department?.name ?? null,
    };
  });
}

export type LostSubmission = {
  id: string;
  createdAt: string;
  reason: string | null;
  /** Что было в заявке — чтобы человека можно было найти и перезвонить. */
  preview: string;
};

/**
 * Заявки с сайта, которые не стали лидами.
 *
 * Пока их не было видно, расхождение с таблицей Tilda приходилось искать
 * глазами. Здесь же сразу понятно, сколько потеряно и почему.
 */
export async function getLostSubmissions(companyId: string): Promise<LostSubmission[]> {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from('form_submissions')
    .select('id, created_at, status, reason, payload')
    .eq('company_id', companyId)
    .in('status', ['rejected', 'error'])
    .order('created_at', { ascending: false })
    .limit(20);

  return (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    reason: row.reason,
    preview: previewOf(row.payload),
  }));
}

/** Короткая выжимка из тела запроса: служебные поля человеку не нужны. */
function previewOf(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '—';

  const skip = ['test', 'formid', 'formname', 'tranid', 'cookies', 'referer'];
  const parts = Object.entries(payload as Record<string, unknown>)
    .filter(([field]) => !field.toLowerCase().startsWith('utm_'))
    .filter(([field]) => !skip.includes(field.toLowerCase()))
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .slice(0, 4)
    .map(([field, value]) => `${field}: ${value}`);

  return parts.length > 0 ? parts.join(' · ') : '—';
}

export async function getSubscription(companyId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + (pick(row) || 0), 0);
}

export type AttendanceRecord = {
  employeeId: string;
  fullName: string;
  role: string;
  /** Отметки по дням: дата → статус. */
  days: Record<string, string>;
  shiftDays: number;
  lateDays: number;
  minutes: number;
  onShiftNow: boolean;
};

/**
 * Табель за период: смены и ручные отметки в одной таблице.
 *
 * Часы считаются по закрытым сменам; открытая смена идёт до текущего момента,
 * иначе сегодняшний день выглядел бы пустым до конца рабочего дня.
 */
export async function getAttendance(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
): Promise<AttendanceRecord[]> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const [{ data: employees }, { data: shifts }, { data: marks }] = await Promise.all([
    supabase
      .from('employees')
      .select('id, full_name, role')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .order('full_name'),
    supabase
      .from('shifts')
      .select('employee_id, started_at, ended_at, late')
      .eq('company_id', companyId)
      .gte('started_at', day.startsAt)
      .lt('started_at', day.endsBefore),
    supabase
      .from('attendance')
      .select('employee_id, date, status')
      .eq('company_id', companyId)
      .gte('date', from)
      .lte('date', to),
  ]);

  const byEmployee = new Map<string, AttendanceRecord>();

  for (const employee of employees ?? []) {
    byEmployee.set(employee.id, {
      employeeId: employee.id,
      fullName: employee.full_name,
      role: employee.role,
      days: {},
      shiftDays: 0,
      lateDays: 0,
      minutes: 0,
      onShiftNow: false,
    });
  }

  for (const shift of shifts ?? []) {
    const record = byEmployee.get(shift.employee_id);
    if (!record) continue;

    const started = new Date(shift.started_at);
    const ended = shift.ended_at ? new Date(shift.ended_at) : new Date();

    record.shiftDays += 1;
    if (shift.late) record.lateDays += 1;
    if (!shift.ended_at) record.onShiftNow = true;
    record.minutes += Math.max(0, Math.round((ended.getTime() - started.getTime()) / 60000));
  }

  for (const mark of marks ?? []) {
    const record = byEmployee.get(mark.employee_id);
    if (record) record.days[mark.date] = mark.status;
  }

  return Array.from(byEmployee.values());
}

// -----------------------------------------------------------------------------
// Отчёт отдела продаж
// -----------------------------------------------------------------------------

export type SalesReportRow = {
  id: string;
  name: string;
  role: string;
  fired: boolean;
  /** Заявок выдано за период. */
  leads: number;
  /** Из них тронуты: статус ушёл с «Нового». */
  worked: number;
  leadsByStatus: Record<string, number>;
  /** Уроков, назначенных на этого продажника за период. */
  trials: number;
  /**
   * Сколько выданных ему заявок купили урок. Метрика менеджера: курс закрывает
   * продажник, и мерить менеджера чужим результатом нечестно.
   */
  soldTrials: number;
  trialsByStatus: Record<string, number>;
  salesCount: number;
  revenue: number;
};

export type SalesReport = {
  rows: SalesReportRow[];
  totals: {
    leads: number;
    worked: number;
    trialsHeld: number;
    salesCount: number;
    revenue: number;
  };
};

/**
 * Строка связанного запроса «урок + его заявка».
 *
 * Типы базы у нас написаны руками и связей между таблицами не описывают,
 * поэтому вложенный `leads!inner(...)` приходится называть здесь.
 */
type SoldTrialRow = {
  lead_id: string | null;
  leads: { assigned_to: string | null } | null;
};

const EMPTY_REPORT_ROW = {
  leads: 0,
  worked: 0,
  trials: 0,
  soldTrials: 0,
  salesCount: 0,
  revenue: 0,
};

/**
 * Отчёт руководителя отдела продаж: что сделал каждый человек за период.
 *
 * Три части считаются по разным основаниям, и свести их в одно нельзя:
 *   • заявки — по дню, когда их выдали сотруднику;
 *   • уроки — по дню, на который назначено занятие;
 *   • деньги — по дню, когда прошёл чек.
 * Клиент, пришедший в понедельник и купивший в пятницу, — это заявка
 * понедельника и деньги пятницы, и оба числа верны.
 *
 * Заявку считаем по дате выдачи, а не по сегодняшнему владельцу: при передаче
 * дата не сбрасывается, поэтому клиент, перешедший к другому человеку, не
 * появляется в его отчёте второй раз. Смена ответственного — это смена
 * ответственного, а не новая заявка.
 *
 * Уволенные остаются в списке: их работа за прошлый период никуда не делась,
 * а продажи закреплены в самих чеках и не зависят от того, кто сейчас ведёт
 * клиента.
 */
export async function getSalesReport(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
): Promise<SalesReport> {
  const supabase = await createServerSupabase();
  const window = zonedDayWindow(from, to, timeZone);

  const [{ data: employees }, leadRows, { data: trials }, soldRows, { data: sales }] =
    await Promise.all([
      supabase
        .from('employees')
        .select('id, full_name, role, status')
        .eq('company_id', companyId)
        .order('status')
        .order('full_name'),
      selectAll((start, end) =>
        supabase
          .from('leads')
          .select('id, status, assigned_to')
          .eq('company_id', companyId)
          .not('assigned_to', 'is', null)
          .gte('assigned_at', window.startsAt)
          .lt('assigned_at', window.endsBefore)
          .range(start, end),
      ),
      supabase
        .from('trials')
        .select('id, status, assigned_to')
        .eq('company_id', companyId)
        .not('assigned_to', 'is', null)
        .gte('date', from)
        .lte('date', to),
      // Проданные уроки считаем от заявки, а не от занятия: урок могли
      // назначить на следующую неделю, но продал его менеджер в этот период.
      selectAll((start, end) =>
        supabase
          .from('trials')
          .select('lead_id, leads!inner(assigned_to, assigned_at)')
          .eq('company_id', companyId)
          .gte('leads.assigned_at', window.startsAt)
          .lt('leads.assigned_at', window.endsBefore)
          .range(start, end),
      ),
      supabase
        .from('sales')
        .select('amount, lead_id, seller_id')
        .eq('company_id', companyId)
        .eq('status', 'paid')
        .gte('sale_date', from)
        .lte('sale_date', to),
    ]);

  const stats = new Map<
    string,
    typeof EMPTY_REPORT_ROW & {
      leadsByStatus: Record<string, number>;
      trialsByStatus: Record<string, number>;
    }
  >();

  const bucket = (id: string) => {
    let value = stats.get(id);
    if (!value) {
      value = { ...EMPTY_REPORT_ROW, leadsByStatus: {}, trialsByStatus: {} };
      stats.set(id, value);
    }
    return value;
  };

  for (const lead of leadRows) {
    if (!lead.assigned_to) continue;
    const target = bucket(lead.assigned_to);
    target.leads += 1;
    if (lead.status !== 'new') target.worked += 1;
    target.leadsByStatus[lead.status] = (target.leadsByStatus[lead.status] ?? 0) + 1;
  }

  for (const trial of trials ?? []) {
    if (!trial.assigned_to) continue;
    const target = bucket(trial.assigned_to);
    target.trials += 1;
    target.trialsByStatus[trial.status] = (target.trialsByStatus[trial.status] ?? 0) + 1;
  }

  // Клиента считаем один раз, даже если урок ему переназначали: продал его
  // менеджер всё равно однажды.
  const soldOnce = new Set<string>();
  for (const row of soldRows as unknown as SoldTrialRow[]) {
    const manager = row.leads?.assigned_to ?? null;
    if (!manager || !row.lead_id || soldOnce.has(row.lead_id)) continue;
    soldOnce.add(row.lead_id);
    bucket(manager).soldTrials += 1;
  }

  // Продавец записан в самом чеке — он и получает деньги. Старые чеки, где его
  // нет, считаем прежним способом: через клиента, за кем тот закреплён.
  const legacy = (sales ?? []).filter((sale) => sale.seller_id === null);
  const legacyOwner = await ownersOfLeads(
    supabase,
    companyId,
    legacy.map((sale) => sale.lead_id),
  );

  for (const sale of sales ?? []) {
    const ownerId =
      sale.seller_id ?? (sale.lead_id ? (legacyOwner.get(sale.lead_id) ?? null) : null);
    if (!ownerId) continue;
    const target = bucket(ownerId);
    target.salesCount += 1;
    target.revenue += Number(sale.amount);
  }

  const rows: SalesReportRow[] = (employees ?? []).map((employee) => {
    const value = stats.get(employee.id);
    return {
      id: employee.id,
      name: employee.full_name,
      role: employee.role,
      fired: employee.status !== 'active',
      leads: value?.leads ?? 0,
      worked: value?.worked ?? 0,
      leadsByStatus: value?.leadsByStatus ?? {},
      trials: value?.trials ?? 0,
      trialsByStatus: value?.trialsByStatus ?? {},
      soldTrials: value?.soldTrials ?? 0,
      salesCount: value?.salesCount ?? 0,
      revenue: value?.revenue ?? 0,
    };
  });

  // Итог считаем по самим записям, а не сложением строк таблицы: чек, чей
  // продавец уже удалён, остаётся выручкой отдела, даже если приписать его
  // некому. Сумма столбца может быть меньше итога — это честнее, чем итог,
  // из которого деньги пропали.
  return {
    rows,
    totals: {
      leads: leadRows.length,
      worked: leadRows.filter((lead) => lead.status !== 'new').length,
      trialsHeld: (trials ?? []).filter((trial) => wasHeld(trial.status)).length,
      salesCount: (sales ?? []).length,
      revenue: (sales ?? []).reduce((sum, sale) => sum + Number(sale.amount), 0),
    },
  };
}

/** Кто сейчас ведёт этих клиентов — для чеков, записанных до появления продавца. */
async function ownersOfLeads(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  leadIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(leadIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();

  const rows = await inChunks(ids, (chunk) =>
    supabase
      .from('leads')
      .select('id, assigned_to')
      .eq('company_id', companyId)
      .not('assigned_to', 'is', null)
      .in('id', chunk),
  );

  return new Map(
    rows
      .filter((row): row is { id: string; assigned_to: string } => row.assigned_to !== null)
      .map((row) => [row.id, row.assigned_to]),
  );
}
