import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { currencySymbol } from '@/lib/format';
import { conversionRate, averageCheck } from '@/lib/metrics';
import { LEAD_STATUS_ORDER, leadStatusFor, type LeadStatus } from '@/lib/lead-status';
import { zonedDayWindow, zonedIsoDate } from '@/lib/period';
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
  /** Локальная дата компании, за которую посчитано. */
  date: string;
  leads: number;
  byStatus: Partial<Record<LeadStatus, number>>;
  /** Из выданных сегодня — сколько уже купили. */
  bought: number;
  /** Чеки, проведённые за день, независимо от даты прихода клиента. */
  salesCount: number;
  revenue: number;
  average: number;
  /** Открытые обещания перезвонить и сколько из них просрочено. */
  promises: number;
  overdue: number;
  week: { leads: number; salesCount: number; revenue: number };
};

export async function employeeStats(
  supabase: Admin,
  input: { companyId: string; employeeId: string; timezone: string },
): Promise<EmployeeStats> {
  const today = zonedIsoDate(new Date(), input.timezone);
  const weekStart = shiftDate(today, -(WEEK_DAYS - 1));

  const day = zonedDayWindow(today, today, input.timezone);
  const week = zonedDayWindow(weekStart, today, input.timezone);

  const [dayLeads, weekLeads, dayMoney, weekMoney, touches] = await Promise.all([
    assignedLeads(supabase, input, day),
    assignedLeads(supabase, input, week),
    ownSales(supabase, input, today, today),
    ownSales(supabase, input, weekStart, today),
    openPromises(supabase, input),
  ]);

  const byStatus: Partial<Record<LeadStatus, number>> = {};
  for (const lead of dayLeads) {
    const status = lead.status as LeadStatus;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  return {
    date: today,
    leads: dayLeads.length,
    byStatus,
    bought: byStatus.sale ?? 0,
    salesCount: dayMoney.count,
    revenue: dayMoney.total,
    average: averageCheck(dayMoney.total, dayMoney.count),
    promises: touches.open,
    overdue: touches.overdue,
    week: {
      leads: weekLeads.length,
      salesCount: weekMoney.count,
      revenue: weekMoney.total,
    },
  };
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
  options: { title: string; currency: string; trialTerm?: string },
): string {
  const sign = currencySymbol(options.currency);
  const lines = [options.title, ''];

  if (stats.leads === 0) {
    lines.push('Новых клиентов сегодня не было.');
  } else {
    lines.push(`👤 Клиентов выдано: <b>${stats.leads}</b>`);
    lines.push(statusBreakdown(stats.byStatus, options.trialTerm));
    lines.push(
      `Купили: <b>${stats.bought}</b> — конверсия ${percent(
        conversionRate(stats.bought, stats.leads),
      )}`,
    );
  }

  lines.push('');

  if (stats.salesCount === 0) {
    lines.push('💰 Чеков сегодня не было.');
  } else {
    lines.push(
      `💰 Чеков за день: <b>${stats.salesCount}</b> на <b>${money(stats.revenue)} ${sign}</b>`,
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

  lines.push('');
  lines.push(
    `<i>За 7 дней: ${stats.week.leads} ${plural(stats.week.leads, 'клиент', 'клиента', 'клиентов')} · ` +
      `${stats.week.salesCount} ${plural(stats.week.salesCount, 'продажа', 'продажи', 'продаж')} · ` +
      `${money(stats.week.revenue)} ${sign}</i>`,
  );

  return lines.join('\n');
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
