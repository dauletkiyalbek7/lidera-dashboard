import 'server-only';

import type { TrendPoint } from '@/components/charts/trend-chart';
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
    .select('id, name, platform, status, objective, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data ?? [];
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

  const [{ data: employees }, { data: leads }, { data: sales }] = await Promise.all([
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
  ]);

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
