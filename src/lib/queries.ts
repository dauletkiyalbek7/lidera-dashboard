import 'server-only';

import type { TrendPoint } from '@/components/charts/trend-chart';
import { resolveShiftRules, type ShiftRules } from '@/lib/attendance';
import { countUntouched, isReached, leadStage } from '@/lib/lead-status';
import { eachDay } from '@/lib/period';
import {
  emptyPerformance,
  summarize,
  type PerformanceInput,
  type PerformanceSummary,
} from '@/lib/metrics';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Запросы кабинета компании.
 *
 * Клиент здесь — пользовательский, поэтому RLS остаётся в силе: даже если
 * companyId подменить, база вернёт пустой результат. Явный фильтр по
 * company_id оставлен ради индексов и читаемости.
 */

export type CreativePerformance = PerformanceSummary & {
  id: string;
  name: string;
  platform: string;
  format: string | null;
};

export type DashboardData = {
  totals: PerformanceSummary;
  trend: TrendPoint[];
  creatives: CreativePerformance[];
  hasAdData: boolean;
};

export async function getDashboardData(
  companyId: string,
  from: string,
  to: string,
): Promise<DashboardData> {
  const supabase = await createServerSupabase();

  const [metricsResult, creativesResult, trialsResult, salesResult, leadsResult] =
    await Promise.all([
      supabase
        .from('ad_metrics')
        .select('creative_id, date, spend, impressions, clicks, leads')
        .eq('company_id', companyId)
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('creatives')
        .select('id, name, platform, format')
        .eq('company_id', companyId),
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
        .gte('created_at', `${from}T00:00:00Z`)
        .lte('created_at', `${to}T23:59:59Z`),
    ]);

  const metrics = metricsResult.data ?? [];
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
    trials: trials.filter((trial) => trial.status === 'completed').length,
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
    .map((creative) => {
      const input = perCreative.get(creative.id) ?? emptyPerformance;
      return {
        id: creative.id,
        name: creative.name,
        platform: creative.platform,
        format: creative.format,
        ...summarize(input),
      };
    })
    .filter((creative) => creative.spend > 0 || creative.leads > 0)
    .sort((a, b) => b.revenue - a.revenue);

  return {
    totals,
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

export type CreativeCard = {
  id: string;
  name: string;
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
  impressions: number;
  clicks: number;
  ctr: number;
  /** Написали / лиды по данным площадки. */
  conversions: number;
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
): Promise<CreativeCard[]> {
  const supabase = await createServerSupabase();

  const [{ data: creatives }, { data: metrics }, { data: leads }, { data: sales }] =
    await Promise.all([
      supabase
        .from('creatives')
        .select('id, name, title, body, status, format, platform, thumbnail_url, video_id')
        .eq('company_id', companyId),
      supabase
        .from('ad_metrics')
        .select('creative_id, campaign_id, spend, impressions, clicks, leads')
        .eq('company_id', companyId)
        .not('creative_id', 'is', null)
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('leads')
        .select('id, creative_id')
        .eq('company_id', companyId)
        .not('creative_id', 'is', null)
        .gte('created_at', `${from}T00:00:00Z`)
        .lte('created_at', `${to}T23:59:59Z`),
      supabase
        .from('sales')
        .select('amount, lead_id')
        .eq('company_id', companyId)
        .eq('status', 'paid')
        .gte('sale_date', from)
        .lte('sale_date', to),
    ]);

  const creativeOfLead = new Map((leads ?? []).map((lead) => [lead.id, lead.creative_id]));

  const { data: campaignRows } = await supabase
    .from('campaigns')
    .select('id, name, whatsapp_number')
    .eq('company_id', companyId);

  const campaignById = new Map((campaignRows ?? []).map((row) => [row.id, row]));
  const placement = new Map<string, { campaigns: Set<string>; numbers: Set<string> }>();

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
      };
      stats.set(id, value);
    }
    return value;
  };

  for (const row of metrics ?? []) {
    if (!row.creative_id) continue;
    const target = bucket(row.creative_id);
    target.spend += Number(row.spend);
    target.impressions += Number(row.impressions);
    target.clicks += Number(row.clicks);
    target.conversions += Number(row.leads);

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

  for (const sale of sales ?? []) {
    const creativeId = sale.lead_id ? creativeOfLead.get(sale.lead_id) : null;
    if (!creativeId) continue;
    const target = bucket(creativeId);
    target.sales += 1;
    target.revenue += Number(sale.amount);
  }

  return (creatives ?? [])
    .map((creative) => {
      const value = stats.get(creative.id);
      const spend = value?.spend ?? 0;
      const impressions = value?.impressions ?? 0;
      const clicks = value?.clicks ?? 0;
      const conversions = value?.conversions ?? 0;

      return {
        id: creative.id,
        name: creative.name,
        title: creative.title,
        body: creative.body,
        status: creative.status,
        format: creative.format,
        platform: creative.platform,
        thumbnailUrl: creative.thumbnail_url,
        hasVideo: Boolean(creative.video_id),
        campaigns: Array.from(placement.get(creative.id)?.campaigns ?? []),
        numbers: Array.from(placement.get(creative.id)?.numbers ?? []),
        spend,
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
  key: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  /** Для кампаний в переписки это начатые переписки, для остальных — лиды Meta. */
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
    costPerConversion: number;
    ctr: number;
    cpc: number;
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
      .select('campaign_id, date, spend, impressions, clicks, leads')
      .eq('company_id', companyId)
      .gte('date', from)
      .lte('date', to),
    supabase
      .from('campaigns')
      .select('id, name, status, whatsapp_number')
      .eq('company_id', companyId),
  ]);

  const campaignById = new Map((campaigns ?? []).map((row) => [row.id, row]));

  type MetricRow = {
    campaign_id: string | null;
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
  };

  const empty = () => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0, days: new Set<string>() });
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
    bucket.impressions += Number(row.impressions);
    bucket.clicks += Number(row.clicks);
    bucket.conversions += Number(row.leads);
    if (Number(row.spend) > 0) bucket.days.add(row.date);
  };

  for (const row of metrics ?? []) {
    if (row.campaign_id) add(byCampaign, row.campaign_id, row);
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
    impressions: bucket.impressions,
    clicks: bucket.clicks,
    conversions: bucket.conversions,
    costPerConversion: bucket.conversions ? bucket.spend / bucket.conversions : 0,
    activeDays: bucket.days.size,
  });

  const campaignRows = Array.from(byCampaign, ([id, bucket]) => {
    const campaign = campaignById.get(id);
    return toRow(
      id,
      bucket,
      campaign?.name ?? 'Без названия',
      campaign?.whatsapp_number ?? null,
      campaign?.status ?? null,
    );
  }).sort((a, b) => b.spend - a.spend);

  const numberRows = Array.from(byNumber, ([number, bucket]) =>
    toRow(number, bucket, number, null, null),
  ).sort((a, b) => b.spend - a.spend);

  const spend = sum(metrics ?? [], (row) => Number(row.spend));
  const impressions = sum(metrics ?? [], (row) => Number(row.impressions));
  const clicks = sum(metrics ?? [], (row) => Number(row.clicks));
  const conversions = sum(metrics ?? [], (row) => Number(row.leads));

  return {
    totals: {
      spend,
      impressions,
      clicks,
      conversions,
      costPerConversion: conversions ? spend / conversions : 0,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      cpc: clicks ? spend / clicks : 0,
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
  assignedTo: string | null;
  assignedName: string | null;
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
): Promise<LeadStats> {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from('leads')
    .select('status, created_at, creative_id')
    .eq('company_id', companyId)
    .gte('created_at', `${from}T00:00:00Z`)
    .lte('created_at', `${to}T23:59:59Z`);

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
): Promise<LeadListItem[]> {
  const supabase = await createServerSupabase();

  const [{ data: leads }, { data: creatives }, { data: employees }] = await Promise.all([
    supabase
      .from('leads')
      .select(
        'id, name, phone, source, platform, status, created_at, creative_id, assigned_to',
      )
      .eq('company_id', companyId)
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`)
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT),
    supabase.from('creatives').select('id, name').eq('company_id', companyId),
    supabase.from('employees').select('id, full_name').eq('company_id', companyId),
  ]);

  const creativeNames = new Map((creatives ?? []).map((row) => [row.id, row.name]));
  const employeeNames = new Map((employees ?? []).map((row) => [row.id, row.full_name]));

  return (leads ?? []).map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    source: lead.source,
    platform: lead.platform,
    status: lead.status,
    created_at: lead.created_at,
    creativeName: lead.creative_id ? (creativeNames.get(lead.creative_id) ?? null) : null,
    assignedTo: lead.assigned_to,
    assignedName: lead.assigned_to ? (employeeNames.get(lead.assigned_to) ?? null) : null,
  }));
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
): Promise<TeamMember[]> {
  const supabase = await createServerSupabase();

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
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`),
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

  const stats = new Map<string, { leads: number; reached: number; won: number; revenue: number }>();
  const bucket = (id: string) => {
    let value = stats.get(id);
    if (!value) {
      value = { leads: 0, reached: 0, won: 0, revenue: 0 };
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

  return (employees ?? []).map((employee) => {
    const value = stats.get(employee.id) ?? { leads: 0, reached: 0, won: 0, revenue: 0 };
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
  leadName: string | null;
  leadPhone: string | null;
};

export async function getTrials(
  companyId: string,
  from: string,
  to: string,
): Promise<TrialListItem[]> {
  const supabase = await createServerSupabase();

  const { data: trials } = await supabase
    .from('trials')
    .select('id, date, status, amount, lead_id')
    .eq('company_id', companyId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .limit(LIST_LIMIT);

  const leads = await fetchLeadContacts(companyId, trials ?? []);

  return (trials ?? []).map((trial) => ({
    id: trial.id,
    date: trial.date,
    status: trial.status,
    amount: Number(trial.amount),
    leadName: trial.lead_id ? (leads.get(trial.lead_id)?.name ?? null) : null,
    leadPhone: trial.lead_id ? (leads.get(trial.lead_id)?.phone ?? null) : null,
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
): Promise<AttendanceRecord[]> {
  const supabase = await createServerSupabase();

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
      .gte('started_at', `${from}T00:00:00Z`)
      .lte('started_at', `${to}T23:59:59Z`),
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
