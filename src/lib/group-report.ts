import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { creativeLabel } from '@/lib/creative-label';
import { currencySymbol } from '@/lib/format';
import { adAccountTotals, refreshCompanyAds, type AdsFreshness } from '@/lib/meta-sync';
import { zonedDayWindow, zonedIsoDate } from '@/lib/period';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import { escapeHtml } from '@/lib/telegram-lead-card';

/**
 * Отчёт в группу Telegram по расписанию.
 *
 * Руководитель не заходит в кабинет каждый час — цифры должны приходить туда,
 * где команда и так переписывается. Группа привязывается командой в чате,
 * времена отправки задаются в настройках проекта, а планировщик, который и так
 * ходит раз в минуту, отправляет отчёт, когда время подошло.
 *
 * Один и тот же отчёт не должен уйти дважды: отметка в report_deliveries
 * ставится до отправки — лучше не получить отчёт, чем получить его шестьдесят
 * раз подряд.
 */

type Admin = SupabaseClient<Database>;

export type ReportPeriod = 'today' | 'yesterday' | 'week' | 'month';

/** Блоки отчёта: набор выбирается на каждое расписание отдельно. */
export const REPORT_SECTIONS = ['leads', 'ads', 'sales', 'breakdown', 'creatives'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const SECTION_LABELS: Record<ReportSection, string> = {
  leads: 'Заявки и статусы',
  ads: 'Расход и показатели рекламы',
  sales: 'Продажи и выручка',
  breakdown: 'Отделы',
  creatives: 'Ролики',
};

export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  today: 'за сегодня',
  yesterday: 'за вчера',
  week: 'за 7 дней',
  month: 'за месяц',
};

/**
 * Сколько времени готовы потратить на обновление цифр перед отправкой.
 *
 * Планировщик ходит раз в минуту и делает не только отчёты, поэтому запас
 * оставляем на всё остальное: ходить в Meta дольше — значит рисковать тем, что
 * функцию оборвут посреди отправки.
 */
const REFRESH_BUDGET_MS = 25_000;

/** Сколько роликов показываем в разборе: длинный список в чате не читают. */
const TOP_CREATIVES = 5;

export type ReportResult = { sent: number };

/**
 * Пройтись по расписаниям и отправить те, чьё время наступило.
 *
 * Вызывается из планировщика раз в минуту вместе с раздачей лидов.
 */
export async function runGroupReports(): Promise<ReportResult> {
  const supabase = createAdminSupabase();
  const startedAt = Date.now();

  const { data: schedules } = await supabase
    .from('report_schedules')
    .select('id, company_id, chat_id, send_at, period, sections, status, created_at')
    .eq('status', 'active');

  if (!schedules || schedules.length === 0) return { sent: 0 };

  const { data: chats } = await supabase
    .from('report_chats')
    .select('id, chat_id, company_id');

  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, timezone, currency, sales_currency');

  const chatById = new Map((chats ?? []).map((row) => [row.id, row]));
  const companyById = new Map((companies ?? []).map((row) => [row.id, row]));

  let sent = 0;

  // Один кабинет на минуту, а не на каждое расписание: в одну минуту могут
  // совпасть два времени, и второму синхронизация уже не нужна.
  const refreshed = new Map<string, AdsFreshness>();

  for (const schedule of schedules) {
    const company = companyById.get(schedule.company_id);
    const chat = chatById.get(schedule.chat_id);
    if (!company || !chat) continue;

    const timezone = company.timezone ?? 'Asia/Almaty';
    const now = new Date();
    const today = zonedIsoDate(now, timezone);

    if (minutesInZone(now, timezone) < timeToMinutes(schedule.send_at)) continue;

    // Расписание, добавленное после сегодняшнего времени отправки, начинает
    // работать с завтра: иначе группа получила бы отчёт в тот же миг, как
    // директор нажал «Добавить», и это выглядело бы поломкой.
    const createdToday = zonedIsoDate(new Date(schedule.created_at), timezone) === today;
    const late =
      createdToday &&
      minutesInZone(new Date(schedule.created_at), timezone) > timeToMinutes(schedule.send_at);

    const { error } = await supabase
      .from('report_deliveries')
      .insert({ schedule_id: schedule.id, date: today });

    // Ошибка вставки — отчёт за этот день уже уходил.
    if (error) continue;
    if (late) continue;

    // Расход берём не тот, что лежит с прошлой синхронизации, а спрашиваем
    // кабинет заново: отчёт отправляют по часам и сверяют с Ads Manager, и
    // расхождение в пару часов читается как ошибка платформы.
    // Если минуты уже почти не осталось, отчёт уходит с тем, что есть:
    // непришедший отчёт хуже отчёта с цифрами двухчасовой давности.
    const freshness =
      refreshed.get(company.id) ??
      (Date.now() - startedAt > REFRESH_BUDGET_MS
        ? ({ state: 'stale', syncedAt: null } as AdsFreshness)
        : await refreshCompanyAds(company.id));
    refreshed.set(company.id, freshness);

    const text = await buildReport(supabase, {
      companyId: company.id,
      companyName: company.name,
      timezone,
      currency: company.currency ?? 'USD',
      salesCurrency: company.sales_currency ?? 'KZT',
      period: schedule.period as ReportPeriod,
      sections: schedule.sections as ReportSection[],
      adsFreshness: freshness,
    });

    await sendMessage(chat.chat_id, text);
    sent += 1;
  }

  return { sent };
}

/** Отправить отчёт прямо сейчас — кнопкой из настроек. */
export async function sendReportNow(scheduleId: string): Promise<boolean> {
  const supabase = createAdminSupabase();

  const { data: schedule } = await supabase
    .from('report_schedules')
    .select('id, company_id, chat_id, period, sections')
    .eq('id', scheduleId)
    .maybeSingle();

  if (!schedule) return false;

  const [{ data: chat }, { data: company }] = await Promise.all([
    supabase.from('report_chats').select('chat_id').eq('id', schedule.chat_id).maybeSingle(),
    supabase
      .from('companies')
      .select('id, name, timezone, currency, sales_currency')
      .eq('id', schedule.company_id)
      .maybeSingle(),
  ]);

  if (!chat || !company) return false;

  // Кнопкой проверяют именно точность цифр — значит и здесь сначала кабинет.
  const freshness = await refreshCompanyAds(company.id);

  const text = await buildReport(supabase, {
    companyId: company.id,
    companyName: company.name,
    timezone: company.timezone ?? 'Asia/Almaty',
    currency: company.currency ?? 'USD',
    salesCurrency: company.sales_currency ?? 'KZT',
    period: schedule.period as ReportPeriod,
    sections: schedule.sections as ReportSection[],
    adsFreshness: freshness,
  });

  await sendMessage(chat.chat_id, text);
  return true;
}

type ReportInput = {
  companyId: string;
  companyName: string;
  timezone: string;
  /** Валюта рекламного кабинета: в ней приходит расход. */
  currency: string;
  /** Валюта денег компании: в ней считается выручка. */
  salesCurrency: string;
  period: ReportPeriod;
  sections: ReportSection[];
  /** Когда обновлялся расход: об этом пишем в отчёте. */
  adsFreshness?: AdsFreshness;
};

/** Собрать текст отчёта. Отдельно от отправки — чтобы можно было проверить. */
export async function buildReport(supabase: Admin, input: ReportInput): Promise<string> {
  const { from, to } = periodRange(input.period, input.timezone);
  const day = zonedDayWindow(from, to, input.timezone);
  const has = (section: ReportSection) => input.sections.includes(section);

  const [metrics, leads, sales, campaigns, departments, creatives] = await Promise.all([
    readAll<{ campaign_id: string | null; creative_id: string | null; spend: number; leads: number; conversations: number }>(
      (start, end) =>
        supabase
          .from('ad_metrics')
          .select('campaign_id, creative_id, spend, leads, conversations')
          .eq('company_id', input.companyId)
          .gte('date', from)
          .lte('date', to)
          .range(start, end),
    ),
    readAll<{ id: string; status: string; department_id: string | null; creative_id: string | null }>(
      (start, end) =>
        supabase
          .from('leads')
          .select('id, status, department_id, creative_id')
          .eq('company_id', input.companyId)
          .gte('created_at', day.startsAt)
          .lt('created_at', day.endsBefore)
          .range(start, end),
    ),
    readAll<{ amount: number; lead_id: string | null }>((start, end) =>
      supabase
        .from('sales')
        .select('amount, lead_id')
        .eq('company_id', input.companyId)
        .eq('status', 'paid')
        .gte('sale_date', from)
        .lte('sale_date', to)
        .range(start, end),
    ),
    readAll<{ id: string; external_id: string | null; department_id: string | null; counted: boolean }>((start, end) =>
      supabase
        .from('campaigns')
        .select('id, external_id, department_id, counted')
        .eq('company_id', input.companyId)
        .range(start, end),
    ),
    supabase
      .from('departments')
      .select('id, name')
      .eq('company_id', input.companyId)
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('creatives')
      .select('id, name, label, format, created_at')
      .eq('company_id', input.companyId)
      .order('created_at')
      .order('id'),
  ]);

  // Кампании найма из отчёта убираем — они портят цену заявки.
  const skipped = new Set(campaigns.filter((row) => !row.counted).map((row) => row.id));
  const counted = metrics.filter((row) => !row.campaign_id || !skipped.has(row.campaign_id));

  const departmentOfCampaign = new Map(campaigns.map((row) => [row.id, row.department_id]));
  // Подпись как в кабинете: «Видео 7», а не строка из Ads Manager на два
  // экрана. Номер — место в списке компании, поэтому порядок здесь тот же.
  const creativeNames = new Map(
    (creatives.data ?? []).map((row, index) => [row.id, creativeLabel(row, index + 1)]),
  );

  const spend = sum(counted, (row) => Number(row.spend));
  const revenue = sum(sales, (row) => Number(row.amount));
  // Показы и охват берём у самой Meta: охват — число людей, и складывать его
  // из дневных строк нельзя (см. adAccountTotals).
  const totals = has('ads') ? await adAccountTotals(input.companyId, from, to) : null;

  // Расход в отчёте — тот, что видно в Ads Manager. У кабинета свои сутки: он
  // живёт восточнее и закрывает день на час раньше нас. Кабинет показывает
  // цифры этот отчёт и сверяет глазами, поэтому здесь важнее совпасть с ним,
  // чем с Главной, где расход разложен по нашим суткам ради цены заявки.
  const shownSpend = totals?.spend ?? spend;

  // Заявки — оттуда же, откуда деньги. Иначе в одной строке встретятся два
  // счёта: расход по кабинету и заявки по нашей базе, а цена заявки окажется
  // не той, что в Ads Manager. Свои цифры остаются в блоке «Заявки и статусы»,
  // где речь уже о работе отдела, а не о рекламе.
  const shownLeads = totals?.leads ?? leads.length;
  const sign = currencySymbol(input.currency);
  const salesSign = currencySymbol(input.salesCurrency);

  const lines: string[] = [
    `📊 <b>${escapeHtml(input.companyName)}</b> — отчёт ${PERIOD_LABELS[input.period]}`,
    `<i>${periodLabel(from, to)}</i>`,
    '',
  ];

  if (has('ads')) {
    lines.push(`Расход: <b>${money(shownSpend, 2)} ${sign}</b>`);
    lines.push(
      `Заявок: <b>${count(shownLeads)}</b>` +
        // Цену заявки показываем, только когда есть из чего её считать:
        // «цена заявки 0 $» при нулевом расходе — это не ноль, а «неизвестно».
        (shownLeads && shownSpend
          ? ` · цена заявки: <b>${money(shownSpend / shownLeads, 2)} ${sign}</b>`
          : ''),
    );
    // Свой счёт Meta в отчёт не выносим: разрыв между её счётчиком и нашими
    // заявками объясняется настройкой выгрузки, а не работой отдела, и в
    // ежедневной сводке только сбивает. Разбираться с ним — отдельный разговор
    // и раздел «Реклама».
    if (totals) {
      lines.push(
        `Показы: <b>${count(totals.impressions)}</b> · охват: <b>${count(totals.reach)}</b>` +
          ` · частота: <b>${totals.frequency.toFixed(2).replace('.', ',')}</b>`,
      );
      lines.push(
        // CTR в кабинете показан с двумя знаками — пусть сходится глазами.
        `CTR: <b>${totals.ctr.toFixed(2).replace('.', ',')}%</b> · CPC: <b>${money(totals.cpc, 2)} ${sign}</b>` +
          ` · CPM: <b>${money(totals.cpm, 2)} ${sign}</b>`,
      );
    }

    lines.push('');
  }

  if (has('leads')) {
    const reached = leads.filter((row) => REACHED.has(row.status)).length;
    const won = leads.filter((row) => row.status === 'sale').length;
    const untouched = leads.filter((row) => row.status === 'new').length;

    // Здесь счёт уже наш, а не кабинета: блок про работу отдела, и цифра
    // законно меньше — доехавших заявок всегда меньше, чем отправленных форм.
    lines.push(
      `Заявок в платформе: <b>${count(leads.length)}</b> · дозвонились: <b>${count(reached)}</b>` +
        ` · купили: <b>${count(won)}</b> · ждут первого касания: <b>${count(untouched)}</b>`,
    );
    lines.push('');
  }

  if (has('sales')) {
    lines.push(
      `Продаж: <b>${count(sales.length)}</b> на <b>${money(revenue)} ${salesSign}</b>` +
        (leads.length ? ` · конверсия ${percent((sales.length / leads.length) * 100)}` : ''),
    );
    lines.push('');
  }

  if (has('breakdown')) {
    const rows = (departments.data ?? []).map((department) => {
        const own = counted.filter(
          (row) => row.campaign_id && departmentOfCampaign.get(row.campaign_id) === department.id,
        );
        const ownLeads = leads.filter((row) => row.department_id === department.id).length;

        // Отдел — это набор кампаний, а кабинет отдал цифры по каждой. Своё
        // остаётся запасным вариантом: не ответила Meta — лучше цифра по нашим
        // суткам, чем прочерк.
        const mine = new Set(
          campaigns
            .filter((row) => row.department_id === department.id && row.external_id)
            .map((row) => row.external_id as string),
        );
        const cabinet = (totals?.campaigns ?? []).filter((row) => mine.has(row.externalId));

        return {
          name: department.name,
          spend: cabinet.length ? sum(cabinet, (row) => row.spend) : sum(own, (row) => Number(row.spend)),
          leads: cabinet.length ? sum(cabinet, (row) => row.leads) : ownLeads,
        };
    });

    // Показываем все отделы, даже пустые: ноль заявок у отдела — это тоже
    // новость, и лучше увидеть её утром в чате, чем через неделю в отчёте.
    if (rows.length > 1) {
      lines.push('<b>Отделы</b>');
      for (const row of rows.sort((left, right) => right.spend - left.spend)) {
        lines.push(
          `• ${escapeHtml(row.name)}: ${money(row.spend, 2)} ${sign} · ${count(row.leads)} ${plural(row.leads, 'заявка', 'заявки', 'заявок')}` +
            (row.leads && row.spend ? ` · ${money(row.spend / row.leads, 2)} ${sign}` : ''),
        );
      }
      lines.push('');
    }

  }

  if (has('creatives')) {
    const perCreative = new Map<string, { spend: number; leads: number }>();
    for (const row of counted) {
      if (!row.creative_id) continue;
      const cell = perCreative.get(row.creative_id) ?? { spend: 0, leads: 0 };
      cell.spend += Number(row.spend);
      perCreative.set(row.creative_id, cell);
    }
    for (const lead of leads) {
      if (!lead.creative_id) continue;
      const cell = perCreative.get(lead.creative_id) ?? { spend: 0, leads: 0 };
      cell.leads += 1;
      perCreative.set(lead.creative_id, cell);
    }

    const top = [...perCreative.entries()]
      .filter(([, value]) => value.spend > 0)
      .sort((left, right) => right[1].spend - left[1].spend)
      .slice(0, TOP_CREATIVES);

    if (top.length > 0) {
      lines.push('<b>Ролики</b>');
      for (const [id, value] of top) {
        lines.push(
          `• ${escapeHtml(creativeNames.get(id) ?? 'Без названия')}: ${money(value.spend, 2)} ${sign} · ${count(value.leads)} ${plural(value.leads, 'заявка', 'заявки', 'заявок')}` +
            (value.leads && value.spend ? ` · ${money(value.spend / value.leads, 2)} ${sign}` : ''),
        );
      }
    }
  }

  // Подпись о свежести — только там, где есть деньги: в отчёте без расхода
  // она ни о чём не говорит.
  // Хвостовые пустые строки убираем: блоки отделяют себя сами, и после
  // последнего остаётся зазор, который в чате виден как обрыв.
  while (lines.at(-1) === '') lines.pop();

  if (has('ads') && input.adsFreshness && input.adsFreshness.state !== 'none') {
    const at = input.adsFreshness.syncedAt;
    const stamp = at ? clock(at, input.timezone) : null;

    lines.push(
      '',
      input.adsFreshness.state === 'fresh'
        ? `<i>Расход из кабинета на ${stamp}</i>`
        : stamp
          ? `<i>Расход на ${stamp}: обновить сейчас не вышло</i>`
          : '<i>Расход с прошлой синхронизации: обновить сейчас не вышло</i>',
    );
  }

  return lines.join('\n').trim();
}

/** Время по часам компании: «23:41». */
function clock(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(moment);
}

/** Статусы, при которых с человеком реально поговорили. */
const REACHED = new Set(['contacted', 'in_progress', 'thinking', 'trial', 'sale', 'rejected']);

/** Границы периода в датах компании. */
export function periodRange(period: ReportPeriod, timeZone: string): {
  from: string;
  to: string;
} {
  const today = zonedIsoDate(new Date(), timeZone);

  if (period === 'yesterday') {
    const yesterday = shiftDays(today, -1);
    return { from: yesterday, to: yesterday };
  }

  if (period === 'week') return { from: shiftDays(today, -6), to: today };

  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };

  return { from: today, to: today };
}

function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Сколько минут прошло с полуночи по местному времени компании. */
function minutesInZone(date: Date, timeZone: string): number {
  const local = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

  const [hours, minutes] = local.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Постраничное чтение: база отдаёт максимум тысячу строк за раз. */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += 1000) {
    const { data } = await page(from, from + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  return rows;
}

function periodLabel(from: string, to: string): string {
  const label = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });

  return from === to ? label(from) : `${label(from)} — ${label(to)}`;
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function money(value: number, digits = 0): string {
  return new Intl.NumberFormat('ru-RU', {
    // Копейки либо есть у всех цифр в строке, либо их нет ни у одной: «459,4 $»
    // рядом с «221,93 $» выглядит обрезанным.
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function count(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function percent(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}%`;
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
