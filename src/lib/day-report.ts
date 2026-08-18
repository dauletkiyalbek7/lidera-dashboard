import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { employeeStats, statsMessage, type EmployeeStats } from '@/lib/employee-stats';
import { currencySymbol } from '@/lib/format';
import { conversionRate } from '@/lib/metrics';
import { zonedIsoDate } from '@/lib/period';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import { escapeHtml } from '@/lib/telegram-lead-card';

/**
 * Отчёт за день.
 *
 * Уходит сам, когда по местному времени компании кончается рабочий день:
 * сотруднику — его цифры, руководителю отдела — сводка по всем. Смысл в том,
 * чтобы разговор о результате был каждый день и на общих числах, а не раз в
 * месяц и по памяти.
 *
 * Планировщик ходит раз в минуту, поэтому единственная защита от повтора —
 * отметка в day_reports. Она ставится до отправки: получить один и тот же
 * отчёт двадцать раз хуже, чем не получить его вовсе.
 */

type Admin = SupabaseClient<Database>;

export type DayReportResult = { reports: number; summaries: number };

/** Кому шлём личный отчёт: тем, кто работает с клиентами. */
const REPORTED_ROLES = ['manager', 'salesperson'];

/** Кому шлём сводку по отделу. */
const SUMMARY_ROLES = ['rop'];

export async function runDayReports(): Promise<DayReportResult> {
  const supabase = createAdminSupabase();

  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, timezone, work_end_time, sales_currency, trial_term');

  let reports = 0;
  let summaries = 0;

  for (const company of companies ?? []) {
    const timezone = company.timezone ?? 'Asia/Almaty';
    if (!dayIsOver(company.work_end_time, timezone)) continue;

    const date = zonedIsoDate(new Date(), timezone);

    const { data: staff } = await supabase
      .from('employees')
      .select('id, full_name, role, telegram_user_id')
      .eq('company_id', company.id)
      .eq('status', 'active')
      .not('telegram_user_id', 'is', null);

    const team = staff ?? [];
    if (team.length === 0) continue;

    const settings = {
      currency: company.sales_currency ?? 'KZT',
      trialTerm: company.trial_term,
    };

    // Считаем один раз на сотрудника: те же числа нужны и ему, и сводке.
    const measured: { name: string; stats: EmployeeStats }[] = [];

    for (const person of team.filter((row) => REPORTED_ROLES.includes(row.role))) {
      const stats = await employeeStats(supabase, {
        companyId: company.id,
        employeeId: person.id,
        timezone,
      });

      measured.push({ name: person.full_name, stats });

      if (!(await claim(supabase, company.id, date, 'employee', person.id))) continue;

      // Пустой день не разбираем: отчёт «ноль, ноль, ноль» люди перестают
      // читать, а вместе с ним и все остальные.
      if (stats.leads === 0 && stats.salesCount === 0) continue;
      if (!person.telegram_user_id) continue;

      await sendMessage(
        person.telegram_user_id,
        statsMessage(stats, {
          title: `📊 <b>День закрыт</b> — ${dayLabel(date)}`,
          ...settings,
        }),
      );

      reports += 1;
    }

    const heads = team.filter((row) => SUMMARY_ROLES.includes(row.role));
    if (heads.length === 0 || measured.length === 0) continue;

    if (!(await claim(supabase, company.id, date, 'summary', null))) continue;

    const text = summaryMessage(company.name, date, measured, settings.currency);

    for (const head of heads) {
      if (!head.telegram_user_id) continue;
      await sendMessage(head.telegram_user_id, text);
      summaries += 1;
    }
  }

  return { reports, summaries };
}

/**
 * Занять отчёт за собой.
 *
 * Отметка ставится вставкой: уникальный индекс не даст записать её дважды, и
 * два одновременных прохода планировщика не отправят два отчёта. false —
 * значит отчёт уже ушёл раньше.
 */
async function claim(
  supabase: Admin,
  companyId: string,
  date: string,
  kind: 'employee' | 'summary',
  employeeId: string | null,
): Promise<boolean> {
  const { error } = await supabase.from('day_reports').insert({
    company_id: companyId,
    employee_id: employeeId,
    date,
    kind,
  });

  return !error;
}

/** Кончился ли рабочий день по местному времени компании. */
function dayIsOver(workEndTime: string | null, timeZone: string): boolean {
  if (!workEndTime) return false;

  const local = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());

  const [hours, minutes] = local.split(':').map(Number);
  const [endHours, endMinutes] = workEndTime.split(':').map(Number);

  return hours * 60 + minutes >= endHours * 60 + endMinutes;
}

/**
 * Сводка руководителю: строка на человека и общий итог.
 *
 * Люди в ней стоят по выручке, а не по алфавиту: сводку читают сверху вниз и
 * дочитывают редко.
 */
function summaryMessage(
  companyName: string,
  date: string,
  measured: { name: string; stats: EmployeeStats }[],
  currency: string,
): string {
  const sign = currencySymbol(currency);
  const leads = sum(measured, (row) => row.stats.leads);
  const sales = sum(measured, (row) => row.stats.salesCount);
  const revenue = sum(measured, (row) => row.stats.revenue);
  const overdue = sum(measured, (row) => row.stats.overdue);

  const rows = [...measured]
    .sort((left, right) => right.stats.revenue - left.stats.revenue)
    .map((row) => {
      const parts = [
        `${row.stats.leads} ${plural(row.stats.leads, 'клиент', 'клиента', 'клиентов')}`,
        `${row.stats.salesCount} ${plural(row.stats.salesCount, 'продажа', 'продажи', 'продаж')}`,
        `${money(row.stats.revenue)} ${sign}`,
      ];
      return `• <b>${escapeHtml(row.name)}</b>: ${parts.join(' · ')}`;
    });

  const lines = [
    `📊 <b>Сводка за ${dayLabel(date)}</b> — ${escapeHtml(companyName)}`,
    '',
    `Клиентов выдано: <b>${leads}</b> · продаж: <b>${sales}</b> (${percent(conversionRate(sales, leads))})`,
    `Выручка за день: <b>${money(revenue)} ${sign}</b>`,
    '',
    ...rows,
  ];

  if (overdue > 0) {
    lines.push('');
    lines.push(`⏰ Просроченных обещаний перезвонить: <b>${overdue}</b>`);
  }

  return lines.join('\n');
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function dayLabel(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
    Math.round(value),
  );
}

function percent(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)}%`;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
