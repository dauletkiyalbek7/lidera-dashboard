import 'server-only';

import type { TrendPoint } from '@/components/charts/trend-chart';
import { resolveShiftRules, type ShiftRules } from '@/lib/attendance';
import { creativeLabel } from '@/lib/creative-label';
import { createRateLookup } from '@/lib/currency';
import { countUntouched, isReached, leadStage } from '@/lib/lead-status';
import { wasHeld } from '@/lib/trial-status';
import { eachDay, zonedDayWindow } from '@/lib/period';
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

  const { data } = await supabase
    .from('campaigns')
    .select('id')
    .eq('company_id', companyId)
    .eq('counted', false);

  if (!data || data.length === 0) return rows;

  const skipped = new Set(data.map((row) => row.id));
  return rows.filter((row) => !row.campaign_id || !skipped.has(row.campaign_id));
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

export type DashboardData = {
  totals: PerformanceSummary;
  /** Общий расход в валюте кабинета. null — пересчёта не было. */
  spendSource: number | null;
  trend: TrendPoint[];
  creatives: CreativePerformance[];
  hasAdData: boolean;
};

export async function getDashboardData(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
): Promise<DashboardData> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const [metricsResult, creativesResult, trialsResult, salesResult, leadsResult] =
    await Promise.all([
      supabase
        .from('ad_metrics')
        .select('creative_id, campaign_id, date, spend, impressions, clicks, leads, conversations, currency')
        .eq('company_id', companyId)
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('creatives')
        .select('id, name, label, platform, format, created_at')
        .eq('company_id', companyId)
        // Порядок важен: номер в подписи «Видео 7» — это место в списке.
        .order('created_at'),
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
      supabase
        .from('leads')
        .select('id, creative_id, status')
        .eq('company_id', companyId)
        .gte('created_at', day.startsAt)
        .lt('created_at', day.endsBefore),
    ]);

  const metrics = await withoutSkippedCampaigns(
    supabase,
    companyId,
    await toCompanyCurrency(supabase, companyId, metricsResult.data ?? []),
  );
  const creatives = creativesResult.data ?? [];
  const trials = trialsResult.data ?? [];
  const sales = salesResult.data ?? [];
  const leads = leadsResult.data ?? [];

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

  return {
    totals,
    spendSource: sum(metrics, (row) => Number(row.spend_source ?? 0)) || null,
    trend,
    creatives: creativePerformance,
    hasAdData: metrics.length > 0,
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

export async function getCampaigns(companyId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('campaigns')
    .select('id, name, platform, status, objective, whatsapp_number, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data ?? [];
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
): Promise<CreativeCard[]> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const [
    { data: creatives },
    { data: metrics },
    { data: leads },
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
        .order('created_at'),
      supabase
        .from('ad_metrics')
        .select(
          'creative_id, campaign_id, date, spend, impressions, clicks, leads, conversations, currency, video_plays, video_completions, video_avg_seconds',
        )
        .eq('company_id', companyId)
        .not('creative_id', 'is', null)
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('leads')
        .select('id, creative_id')
        .eq('company_id', companyId)
        .not('creative_id', 'is', null)
        .gte('created_at', day.startsAt)
        .lt('created_at', day.endsBefore),
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

  const creativeOfLead = new Map((leads ?? []).map((lead) => [lead.id, lead.creative_id]));

  const { data: campaignRows } = await supabase
    .from('campaigns')
    .select('id, name, whatsapp_number')
    .eq('company_id', companyId);

  const campaignById = new Map((campaignRows ?? []).map((row) => [row.id, row]));
  const placement = new Map<string, { campaigns: Set<string>; numbers: Set<string> }>();

  // Расход приходит в валюте кабинета — приводим к валюте компании, а кампании
  // найма из отчёта убираем.
  const spendRows = await withoutSkippedCampaigns(
    supabase,
    companyId,
    await toCompanyCurrency(supabase, companyId, metrics ?? []),
  );

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

  for (const lead of leads ?? []) {
    if (lead.creative_id) bucket(lead.creative_id).crmLeads += 1;
  }

  // Пробное занятие — середина воронки: между обращением и покупкой.
  for (const trial of trials ?? []) {
    const creativeId = trial.lead_id ? creativeOfLead.get(trial.lead_id) : null;
    if (creativeId && trial.status === 'completed') bucket(creativeId).trials += 1;
  }

  for (const sale of sales ?? []) {
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
};

/**
 * Расход и результат по кампаниям и по номерам WhatsApp за период.
 *
 * Считаем из ad_metrics — тех же дневных строк, что отдаёт рекламный кабинет.
 * Кампании без единого дня в периоде не показываем: пустая строка в отчёте
 * только мешает искать глазами ту, которая крутится.
 */
export async function getAdBreakdown(
  companyId: string,
  from: string,
  to: string,
): Promise<AdBreakdown> {
  const supabase = await createServerSupabase();

  const [{ data: metrics }, { data: campaigns }] = await Promise.all([
    supabase
      .from('ad_metrics')
      .select('campaign_id, date, spend, impressions, clicks, leads, conversations, currency')
      .eq('company_id', companyId)
      .gte('date', from)
      .lte('date', to),
    supabase
      .from('campaigns')
      .select('id, name, status, whatsapp_number, counted')
      .eq('company_id', companyId),
  ]);

  const campaignById = new Map((campaigns ?? []).map((row) => [row.id, row]));

  // Выручка приходит из CRM: продажа привязана к заявке, заявка знает свою
  // кампанию. Без продаж колонка честно пустует, а не показывает ноль-обман.
  const [{ data: leadRows }, { data: saleRows }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, campaign_id')
      .eq('company_id', companyId)
      .not('campaign_id', 'is', null),
    supabase
      .from('sales')
      .select('amount, lead_id')
      .eq('company_id', companyId)
      .eq('status', 'paid')
      .gte('sale_date', from)
      .lte('sale_date', to),
  ]);

  const campaignOfLead = new Map(
    (leadRows ?? []).map((row) => [row.id, row.campaign_id as string]),
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
    const number = row.campaign_id
      ? campaignById.get(row.campaign_id)?.whatsapp_number
      : null;
    if (number) add(byNumber, number, row);
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
  /** Сумма оплаченной продажи, если чек уже проведён. */
  saleAmount: number | null;
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
): Promise<LeadStats> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const { data } = await supabase
    .from('leads')
    .select('status, created_at, creative_id')
    .eq('company_id', companyId)
    .gte('created_at', day.startsAt)
    .lt('created_at', day.endsBefore);

  const leads = data ?? [];
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

export async function getLeads(
  companyId: string,
  from: string,
  to: string,
  timeZone: string,
): Promise<LeadListItem[]> {
  const supabase = await createServerSupabase();
  const day = zonedDayWindow(from, to, timeZone);

  const [{ data: leads }, { data: creatives }, { data: employees }] = await Promise.all([
    supabase
      .from('leads')
      .select(
        'id, name, phone, source, platform, status, created_at, creative_id, assigned_to',
      )
      .eq('company_id', companyId)
      .gte('created_at', day.startsAt)
      .lt('created_at', day.endsBefore)
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from('creatives')
      .select('id, name, label, format, created_at')
      .eq('company_id', companyId)
      .order('created_at'),
    supabase.from('employees').select('id, full_name').eq('company_id', companyId),
  ]);

  const creativeNames = new Map(
    (creatives ?? []).map((row, index) => [row.id, creativeLabel(row, index + 1)]),
  );
  const employeeNames = new Map((employees ?? []).map((row) => [row.id, row.full_name]));

  // Продажи по этим заявкам: чек мог быть проведён продажником в боте, и
  // тогда предлагать «оформить продажу» второй раз нельзя — так и появляются
  // задвоенные суммы в отчёте.
  const leadIds = (leads ?? []).map((lead) => lead.id);
  const { data: sales } = leadIds.length
    ? await supabase
        .from('sales')
        .select('lead_id, amount')
        .eq('company_id', companyId)
        .eq('status', 'paid')
        .in('lead_id', leadIds)
    : { data: [] as { lead_id: string | null; amount: number }[] };

  const saleByLead = new Map<string, number>();
  for (const sale of sales ?? []) {
    if (!sale.lead_id) continue;
    saleByLead.set(sale.lead_id, (saleByLead.get(sale.lead_id) ?? 0) + Number(sale.amount));
  }

  return (leads ?? []).map((lead) => ({
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
    saleAmount: saleByLead.get(lead.id) ?? null,
  }));
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
    .in('status', ['new', 'no_answer', 'contacted', 'in_progress', 'thinking']);

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

  const [{ data: employees }, { data: leads }, { data: sales }, { data: openShifts }] =
    await Promise.all([
    supabase
      .from('employees')
      .select('*')
      .eq('company_id', companyId)
      .order('status')
      .order('full_name'),
    supabase
      .from('leads')
      .select('id, status, assigned_to')
      .eq('company_id', companyId)
      .not('assigned_to', 'is', null)
      .gte('created_at', day.startsAt)
      .lt('created_at', day.endsBefore),
    supabase
      .from('sales')
      .select('amount, lead_id')
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

  // Продажа привязана к лиду, а лид — к сотруднику: выручка идёт тому,
  // кто вёл клиента, даже если продажу занесли позже.
  const leadOwner = new Map((leads ?? []).map((lead) => [lead.id, lead.assigned_to]));

  const stats = new Map<string, TeamStats>();
  const bucket = (id: string) => {
    let value = stats.get(id);
    if (!value) {
      value = { ...EMPTY_TEAM_STATS };
      stats.set(id, value);
    }
    return value;
  };

  for (const lead of leads ?? []) {
    if (!lead.assigned_to) continue;
    const target = bucket(lead.assigned_to);
    target.leads += 1;
    if (isReached(lead.status)) target.reached += 1;
    if (leadStage(lead.status) === 'won') target.won += 1;
  }

  for (const sale of sales ?? []) {
    const ownerId = sale.lead_id ? leadOwner.get(sale.lead_id) : null;
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
};

export async function getTrials(
  companyId: string,
  from: string,
  to: string,
): Promise<TrialListItem[]> {
  const supabase = await createServerSupabase();

  const { data: trials } = await supabase
    .from('trials')
    .select('id, date, status, amount, lead_id, assigned_to, starts_at')
    .eq('company_id', companyId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .limit(LIST_LIMIT);

  const leadIds = [...new Set((trials ?? []).map((row) => row.lead_id).filter(Boolean))] as string[];

  const [leads, { data: employees }, { data: sales }] = await Promise.all([
    fetchLeadContacts(companyId, trials ?? []),
    supabase.from('employees').select('id, full_name').eq('company_id', companyId),
    // Чек мог провести бот — тогда сумму спрашивать во второй раз нельзя.
    leadIds.length
      ? supabase
          .from('sales')
          .select('lead_id, amount')
          .eq('company_id', companyId)
          .eq('status', 'paid')
          .in('lead_id', leadIds)
      : Promise.resolve({ data: [] as { lead_id: string | null; amount: number }[] }),
  ]);

  const sellerNames = new Map((employees ?? []).map((row) => [row.id, row.full_name]));
  const paidByLead = new Map(
    (sales ?? [])
      .filter((row) => row.lead_id)
      .map((row) => [row.lead_id as string, Number(row.amount)]),
  );

  return (trials ?? []).map((trial) => ({
    id: trial.id,
    date: trial.date,
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

export type SaleListItem = {
  id: string;
  sale_date: string;
  product: string | null;
  amount: number;
  status: string;
  leadName: string | null;
  leadPhone: string | null;
};

export async function getSales(
  companyId: string,
  from: string,
  to: string,
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

  const leads = await fetchLeadContacts(companyId, sales ?? []);

  return (sales ?? []).map((sale) => ({
    id: sale.id,
    sale_date: sale.sale_date,
    product: sale.product,
    amount: Number(sale.amount),
    status: sale.status,
    leadName: sale.lead_id ? (leads.get(sale.lead_id)?.name ?? null) : null,
    leadPhone: sale.lead_id ? (leads.get(sale.lead_id)?.phone ?? null) : null,
  }));
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

  const [{ data: sales }, { data: staff }] = await Promise.all([
    supabase
      .from('sales')
      .select('id, amount, product, sale_date, lead_id')
      .eq('company_id', companyId)
      .in('id', saleIds),
    staffIds.length
      ? supabase.from('employees').select('id, full_name').in('id', staffIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const saleById = new Map((sales ?? []).map((sale) => [sale.id, sale]));
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

/** Контакты лидов, на которые ссылаются переданные записи. */
async function fetchLeadContacts(
  companyId: string,
  rows: { lead_id: string | null }[],
): Promise<Map<string, { name: string; phone: string | null }>> {
  const ids = [...new Set(rows.map((row) => row.lead_id).filter(Boolean))] as string[];
  if (ids.length === 0) return new Map();

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('leads')
    .select('id, name, phone')
    .eq('company_id', companyId)
    .in('id', ids);

  return new Map((data ?? []).map((lead) => [lead.id, { name: lead.name, phone: lead.phone }]));
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
