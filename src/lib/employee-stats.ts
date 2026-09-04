import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { currencySymbol } from '@/lib/format';
import { conversionRate, averageCheck, type FunnelType } from '@/lib/metrics';
import { LEAD_STATUS_ORDER, leadStatusFor, type LeadStatus } from '@/lib/lead-status';
import { zonedDayWindow, zonedIsoDate } from '@/lib/period';
import { TRIAL_STATUS, TRIAL_STATUS_ORDER } from '@/lib/trial-status';
import { trialWords } from '@/lib/trial-term';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Личные показатели сотрудника — то, что он видит о себе в боте.
 *
 * Считается по его собственным клиентам: сотруднику важно, сколько ему
 * досталось и что он из этого сделал, а не общий котёл компании. Отсюда же
 * берётся вечерний отчёт — иначе цифры в кнопке и в отчёте разойдутся, и
 * доверия не будет ни к тем, ни к другим.
 *
 * Два блока считаются по разным основаниям, и это намеренно:
 *   • клиенты — те, кого выдали сегодня, с их сегодняшними статусами;
 *   • деньги — чеки, проведённые сегодня, даже если клиент пришёл вчера.
 * Свести их в одно число нельзя: вчерашний клиент, купивший сегодня, —
 * сегодняшние деньги и вчерашний лид.
 */

type Admin = SupabaseClient<Database>;

const WEEK_DAYS = 7;

export type EmployeeStats = {
  /** Локальная дата компании, за которую посчитано (конец периода). */
  date: string;
  /** Подпись периода — её же видит человек в заголовке. */
  label: string;
  leads: number;
  byStatus: Partial<Record<LeadStatus, number>>;
  /** Из выданных сегодня — сколько уже купили курс. */
  bought: number;
  /**
   * Сколько выданных клиентов купили пробный урок.
   *
   * Считается по записям на урок, а не по текущему статусу: клиент, который
   * после урока купил курс, стоит уже в «Продаже», и по статусу его урок
   * потерялся бы. А менеджеру платят именно за проданные уроки.
   */
  soldTrials: number;
  /** Чеки, проведённые за день, независимо от даты прихода клиента. */
  salesCount: number;
  revenue: number;
  average: number;
  /** Открытые обещания перезвонить и сколько из них просрочено. */
  promises: number;
  overdue: number;
  /**
   * Уроки продажника за период. У менеджера их нет, у продажника наоборот —
   * заявок нет, а вся работа здесь, поэтому блоки в отчёте раздельные.
   */
  trials: Partial<Record<string, number>>;
  trialsTotal: number;
  /**
   * Хвост «за 7 дней» — только у отчёта за один день. Когда человек сам
   * выбрал период, эта строка сбивает: он спрашивал про полгода, а внизу
   * неделя.
   */
  week?: { leads: number; salesCount: number; revenue: number };
};

export async function employeeStats(
  supabase: Admin,
  input: {
    companyId: string;
    employeeId: string;
    timezone: string;
    /** Период в датах компании. По умолчанию — сегодня. */
    from?: string;
    to?: string;
    label?: string;
  },
): Promise<EmployeeStats> {
  const today = zonedIsoDate(new Date(), input.timezone);
  const from = input.from ?? today;
  const to = input.to ?? today;
  const singleDay = from === to && to === today;

  const window = zonedDayWindow(from, to, input.timezone);

  const [leads, money, touches, trials, soldTrials] = await Promise.all([
    assignedLeads(supabase, input, window),
    ownSales(supabase, input, from, to),
    openPromises(supabase, input),
    ownTrials(supabase, input, from, to),
    trialsSoldBy(supabase, input, window),
  ]);

  const byStatus: Partial<Record<LeadStatus, number>> = {};
  for (const lead of leads) {
    const status = lead.status as LeadStatus;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  const byTrial: Partial<Record<string, number>> = {};
  for (const trial of trials) {
    byTrial[trial.status] = (byTrial[trial.status] ?? 0) + 1;
  }

  // Хвост за неделю считаем только для отчёта за день: в нём он и полезен —
  // сегодняшний ноль не выглядит провалом, когда рядом видна неделя.
  const week = singleDay
    ? await (async () => {
        const weekStart = shiftDate(today, -(WEEK_DAYS - 1));
        const [weekLeads, weekMoney] = await Promise.all([
          assignedLeads(supabase, input, zonedDayWindow(weekStart, today, input.timezone)),
          ownSales(supabase, input, weekStart, today),
        ]);
        return {
          leads: weekLeads.length,
          salesCount: weekMoney.count,
          revenue: weekMoney.total,
        };
      })()
    : undefined;

  return {
    date: to,
    label: input.label ?? 'сегодня',
    leads: leads.length,
    byStatus,
    bought: byStatus.sale ?? 0,
    soldTrials,
    salesCount: money.count,
    revenue: money.total,
    average: averageCheck(money.total, money.count),
    promises: touches.open,
    overdue: touches.overdue,
    trials: byTrial,
    trialsTotal: trials.length,
    week,
  };
}

/**
 * Сколько клиентов менеджера дошли до записи на урок.
 *
 * Запрос идёт от уроков к заявкам (`leads!inner`), а не наоборот: список
 * заявок за «всё время» — это тысячи идентификаторов, которые в фильтр
 * `in(...)` не помещаются. Клиент считается один раз, даже если урок ему
 * переназначали: продал менеджер его всё равно однажды.
 */
async function trialsSoldBy(
  supabase: Admin,
  input: { companyId: string; employeeId: string },
  window: { startsAt: string; endsBefore: string },
): Promise<number> {
  const { data } = await supabase
    .from('trials')
    .select('lead_id, leads!inner(assigned_to, assigned_at)')
    .eq('company_id', input.companyId)
    .eq('leads.assigned_to', input.employeeId)
    .gte('leads.assigned_at', window.startsAt)
    .lt('leads.assigned_at', window.endsBefore);

  return new Set((data ?? []).map((row) => row.lead_id).filter(isId)).size;
}

/** Уроки, которые вёл этот человек. Считаются по дню занятия. */
async function ownTrials(
  supabase: Admin,
  input: { companyId: string; employeeId: string },
  from: string,
  to: string,
): Promise<{ status: string }[]> {
  const { data } = await supabase
    .from('trials')
    .select('status')
    .eq('company_id', input.companyId)
    .eq('assigned_to', input.employeeId)
    .gte('date', from)
    .lte('date', to);

  return data ?? [];
}

/** Клиенты, выданные сотруднику в этом окне. */
async function assignedLeads(
  supabase: Admin,
  input: { companyId: string; employeeId: string },
  window: { startsAt: string; endsBefore: string },
): Promise<{ status: string }[]> {
  const { data } = await supabase
    .from('leads')
    .select('status')
    .eq('company_id', input.companyId)
    .eq('assigned_to', input.employeeId)
    .gte('assigned_at', window.startsAt)
    .lt('assigned_at', window.endsBefore);

  return data ?? [];
}

/**
 * Деньги сотрудника за период.
 *
 * Продавец записан в самой продаже — по нему и считаем. Старые продажи, в
 * которых его нет, добираем прежним способом: через клиента, за кем он
 * закреплён. Двух запросов достаточно: чеков за неделю у одного отдела
 * десятки, а не тысячи.
 */
async function ownSales(
  supabase: Admin,
  input: { companyId: string; employeeId: string },
  from: string,
  to: string,
): Promise<{ count: number; total: number }> {
  const { data: sales } = await supabase
    .from('sales')
    .select('amount, lead_id, seller_id')
    .eq('company_id', input.companyId)
    .eq('status', 'paid')
    .gte('sale_date', from)
    .lte('sale_date', to);

  const rows = sales ?? [];
  if (rows.length === 0) return { count: 0, total: 0 };

  const mineBySeller = rows.filter((sale) => sale.seller_id === input.employeeId);

  // Продажи без продавца — те, что записаны до появления этого поля.
  const legacy = rows.filter((sale) => sale.seller_id === null);
  const leadIds = [...new Set(legacy.map((sale) => sale.lead_id).filter(isId))];

  const own = new Set<string>();
  if (leadIds.length > 0) {
    const { data: mine } = await supabase
      .from('leads')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('assigned_to', input.employeeId)
      .in('id', leadIds);

    for (const lead of mine ?? []) own.add(lead.id);
  }

  const counted = [
    ...mineBySeller,
    ...legacy.filter((sale) => sale.lead_id !== null && own.has(sale.lead_id)),
  ];

  return {
    count: counted.length,
    total: counted.reduce((sum, sale) => sum + Number(sale.amount), 0),
  };
}

/** Обещания перезвонить, которые ещё висят. */
async function openPromises(
  supabase: Admin,
  input: { companyId: string; employeeId: string },
): Promise<{ open: number; overdue: number }> {
  const { data } = await supabase
    .from('lead_touches')
    .select('remind_at')
    .eq('company_id', input.companyId)
    .eq('employee_id', input.employeeId)
    .is('done_at', null)
    .not('remind_at', 'is', null);

  const now = Date.now();
  const rows = data ?? [];

  return {
    open: rows.length,
    overdue: rows.filter(
      (row) => row.remind_at !== null && new Date(row.remind_at).getTime() < now,
    ).length,
  };
}

function isId(value: string | null): value is string {
  return value !== null;
}

/** Дата на n дней в сторону, в том же виде «ГГГГ-ММ-ДД». */
function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Текст для чата
// -----------------------------------------------------------------------------

/**
 * Показатели словами.
 *
 * Одна и та же запись и в кнопке «Мои показатели», и в вечернем отчёте:
 * сотрудник не должен сверять два разных бланка про один день.
 */
export function statsMessage(
  stats: EmployeeStats,
  options: {
    title: string;
    currency: string;
    trialTerm?: string;
    /** Воронка компании: без пробного шага менеджера меряют покупкой. */
    funnelType?: FunnelType;
  },
): string {
  const sign = currencySymbol(options.currency);
  const lines = [options.title, ''];

  // У продажника заявок нет вовсе — вся его работа в уроках. Показывать ему
  // «клиентов не было» бессмысленно: их ему и не выдают.
  if (stats.trialsTotal > 0) {
    lines.push(`🎓 Уроков: <b>${stats.trialsTotal}</b>`);
    lines.push(trialBreakdown(stats.trials));
    lines.push('');
  }

  if (stats.leads === 0 && stats.trialsTotal === 0) {
    lines.push('Новых клиентов за этот период не было.');
    lines.push('');
  } else if (stats.leads > 0) {
    lines.push(`👤 Клиентов выдано: <b>${stats.leads}</b>`);
    lines.push(statusBreakdown(stats.byStatus, options.trialTerm));

    // Работа менеджера кончается проданным уроком: курс закрывает уже
    // продажник, и мерить менеджера чужим результатом нечестно. Там, где
    // урока в воронке нет, считать по-прежнему нечего — остаётся покупка.
    const sold = options.funnelType === 'direct' ? stats.bought : stats.soldTrials;
    const soldLabel =
      options.funnelType === 'direct'
        ? 'Купили'
        : `Купили ${trialWords(options.trialTerm).accusative}`;

    lines.push(
      `${soldLabel}: <b>${sold}</b> — конверсия ${percent(
        conversionRate(sold, stats.leads),
      )}`,
    );
    lines.push('');
  }

  if (stats.salesCount === 0) {
    lines.push('💰 Чеков за этот период не было.');
  } else {
    lines.push(
      `💰 Чеков: <b>${stats.salesCount}</b> на <b>${money(stats.revenue)} ${sign}</b>`,
    );
    lines.push(`Средний чек: ${money(stats.average)} ${sign}`);
  }

  if (stats.promises > 0) {
    lines.push('');
    lines.push(
      stats.overdue > 0
        ? `⏰ Обещали перезвонить: ${stats.promises}, из них <b>просрочено ${stats.overdue}</b>`
        : `⏰ Обещали перезвонить: ${stats.promises}`,
    );
  }

  if (stats.week) {
    lines.push('');
    lines.push(
      `<i>За 7 дней: ${stats.week.leads} ${plural(stats.week.leads, 'клиент', 'клиента', 'клиентов')} · ` +
        `${stats.week.salesCount} ${plural(stats.week.salesCount, 'продажа', 'продажи', 'продаж')} · ` +
        `${money(stats.week.revenue)} ${sign}</i>`,
    );
  }

  return lines.join('\n');
}

/** Разбор уроков по исходам — только то, что реально было. */
function trialBreakdown(byStatus: Partial<Record<string, number>>): string {
  const parts = TRIAL_STATUS_ORDER.filter((status) => (byStatus[status] ?? 0) > 0).map(
    (status) => `${TRIAL_STATUS[status].label} ${byStatus[status]}`,
  );
  return parts.length > 0 ? `   ${parts.join(' · ')}` : '   —';
}

/** Разбор выданных клиентов по статусам — только то, что реально есть. */
function statusBreakdown(
  byStatus: Partial<Record<LeadStatus, number>>,
  trialTerm?: string,
): string {
  const parts = LEAD_STATUS_ORDER.filter((status) => (byStatus[status] ?? 0) > 0).map(
    (status) => `${leadStatusFor(status, trialTerm).label} ${byStatus[status]}`,
  );
  return parts.length > 0 ? `   ${parts.join(' · ')}` : '   —';
}

function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
    Math.round(value),
  );
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** conversionRate уже отдаёт проценты — умножать второй раз нельзя. */
function percent(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)}%`;
}
