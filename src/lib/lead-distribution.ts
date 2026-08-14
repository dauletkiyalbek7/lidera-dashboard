import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveShiftRules } from '@/lib/attendance';
import type { LeadStatus } from '@/lib/lead-status';
import type { FunnelType } from '@/lib/metrics';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import { leadCard, statusButtons } from '@/lib/telegram-lead-card';

/**
 * Авто-раздача лидов.
 *
 * Три правила, из которых всё следует:
 *
 *   1. Лид получает только тот, кто открыл смену. Смена и есть выключатель:
 *      ночью заявки просто ждут утра, а не висят на том, кто спит.
 *
 *   2. Поровну. Лид уходит тому, кто получил меньше всех за текущую смену;
 *      при равенстве — тому, кто дольше всех не получал. Считаются именно
 *      выданные за смену, а не открытые сейчас: иначе быстрый менеджер,
 *      закрывающий заявки, наказывался бы новой порцией работы.
 *
 *   3. Лид не отбирают. Достался — остался, даже если менеджер не дозвонился.
 *      Второй звонок с чужого номера клиент считает спамом, а у менеджера
 *      пропадает смысл дожимать. Вместо отъёма — напоминания: см. touch-runner.
 *
 * Запускается при создании лида, при открытии смены и раз в минуту из базы
 * (pg_cron). Функции идемпотентны: повторный вызов ничего не ломает.
 *
 * Работает сервисным ключом — у бота и планировщика нет пользовательской
 * сессии, поэтому RLS здесь не действует и каждый запрос сам ограничен
 * company_id.
 */

type Admin = SupabaseClient<Database>;

/** Лид считается активным, пока он не куплен, не отказ и не на пробном. */
const ACTIVE_STATUSES: LeadStatus[] = [
  'new',
  'no_answer',
  'contacted',
  'in_progress',
  'thinking',
];

export type DistributionResult = {
  assigned: number;
  queued: number;
};

/**
 * Раздача по одной компании.
 *
 * Раздаются только лиды. Урок продажнику назначает менеджер вручную: время
 * он согласовывает с клиентом и выбирает того, кто в этот час свободен —
 * очередь тут ничего не решает.
 */
export async function runDistribution(companyId: string): Promise<DistributionResult> {
  const supabase = createAdminSupabase();

  const { data: company } = await supabase
    .from('companies')
    .select(
      'id, funnel_type, auto_assign, max_open_leads, shift_mode, timezone, work_start_time, work_end_time, work_days, late_grace_minutes',
    )
    .eq('id', companyId)
    .maybeSingle();

  if (!company || !company.auto_assign) return { assigned: 0, queued: 0 };

  return distributeQueue(supabase, company);
}

/** Раздача по всем компаниям — то, что дёргает планировщик. */
export async function runDistributionForAll(): Promise<
  DistributionResult & { companies: number }
> {
  const supabase = createAdminSupabase();
  const { data: companies } = await supabase
    .from('companies')
    .select('id')
    .eq('auto_assign', true)
    .eq('status', 'active');

  const totals = { assigned: 0, queued: 0, companies: 0 };

  for (const company of companies ?? []) {
    const result = await runDistribution(company.id);
    totals.assigned += result.assigned;
    totals.queued += result.queued;
    totals.companies += 1;
  }

  return totals;
}

type CompanySettings = {
  id: string;
  funnel_type: string;
  max_open_leads: number;
  shift_mode: string;
  timezone: string;
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  late_grace_minutes: number;
};

type Candidate = {
  id: string;
  full_name: string;
  telegram_user_id: number | null;
  /** Сколько лидов выдано за текущую смену — по нему и делим поровну. */
  received: number;
  /** Сколько активных лидов висит сейчас — по нему работает ограничение. */
  open: number;
  lastAssignedAt: number;
};

/**
 * Кому можно отдать лид: активный менеджер с открытой сменой, у которого ещё
 * есть место. Возвращается отсортированным — первый и есть получатель.
 */
async function eligibleManagers(
  supabase: Admin,
  company: CompanySettings,
): Promise<Candidate[]> {
  const { data: employees } = await supabase
    .from('employees')
    .select(
      'id, full_name, telegram_user_id, shift_mode, work_start_time, work_end_time, work_days, late_grace_minutes',
    )
    .eq('company_id', company.id)
    .eq('role', 'manager')
    .eq('status', 'active');

  if (!employees || employees.length === 0) return [];

  const ids = employees.map((employee) => employee.id);

  const [{ data: openShifts }, { data: activeLeads }, { data: history }] = await Promise.all([
    supabase
      .from('shifts')
      .select('employee_id, started_at')
      .in('employee_id', ids)
      .is('ended_at', null),
    supabase
      .from('leads')
      .select('assigned_to')
      .eq('company_id', company.id)
      .in('assigned_to', ids)
      .in('status', ACTIVE_STATUSES),
    supabase
      .from('lead_assignments')
      .select('employee_id, assigned_at')
      .in('employee_id', ids)
      .gte('assigned_at', startOfToday(company.timezone))
      .order('assigned_at', { ascending: false })
      .limit(1000),
  ]);

  const shiftStart = new Map(
    (openShifts ?? []).map((shift) => [shift.employee_id, shift.started_at] as const),
  );

  const open = new Map<string, number>();
  for (const lead of activeLeads ?? []) {
    if (lead.assigned_to) open.set(lead.assigned_to, (open.get(lead.assigned_to) ?? 0) + 1);
  }

  // Первая запись по сотруднику — самая свежая: список уже отсортирован.
  const lastAssigned = new Map<string, number>();
  const received = new Map<string, number>();

  for (const row of history ?? []) {
    if (!lastAssigned.has(row.employee_id)) {
      lastAssigned.set(row.employee_id, new Date(row.assigned_at).getTime());
    }

    // Считаем только выданное после открытия смены: вчерашние заявки не
    // должны мешать сегодняшнему равенству.
    const since = shiftStart.get(row.employee_id);
    if (since && new Date(row.assigned_at).getTime() >= new Date(since).getTime()) {
      received.set(row.employee_id, (received.get(row.employee_id) ?? 0) + 1);
    }
  }

  // Режим считается по каждому отдельно: в одной компании уживаются офисные
  // менеджеры со сменами и удалённые, которым отмечаться не нужно.
  return employees
    .filter(
      (employee) =>
        resolveShiftRules(employee, company).mode === 'always' ||
        shiftStart.has(employee.id),
    )
    .map((employee) => ({
      id: employee.id,
      full_name: employee.full_name,
      telegram_user_id: employee.telegram_user_id,
      received: received.get(employee.id) ?? 0,
      open: open.get(employee.id) ?? 0,
      lastAssignedAt: lastAssigned.get(employee.id) ?? 0,
    }))
    .filter((employee) => employee.open < company.max_open_leads)
    .sort(byFairness);
}

/** Меньше всех получил за смену; при равенстве — дольше всех не получал. */
function byFairness(a: Candidate, b: Candidate): number {
  return a.received - b.received || a.lastAssignedAt - b.lastAssignedAt;
}

/** Начало суток компании — точка отсчёта для «сегодня». */
function startOfToday(timeZone: string): string {
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  // Запас в сутки: точная граница здесь не нужна, важно не тянуть всю историю.
  return new Date(`${local}T00:00:00Z`).toISOString();
}

/** Раздать всё, что лежит без ответственного. Порядок — от самых старых. */
async function distributeQueue(supabase: Admin, company: CompanySettings) {
  const { data: queue } = await supabase
    .from('leads')
    .select('id, name, phone, source, platform, status, creative_id, touch_count')
    .eq('company_id', company.id)
    .is('assigned_to', null)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: true })
    .limit(100);

  if (!queue || queue.length === 0) return { assigned: 0, queued: 0 };

  const managers = await eligibleManagers(supabase, company);
  if (managers.length === 0) return { assigned: 0, queued: queue.length };

  const labels = await creativeLabels(
    supabase,
    company.id,
    queue.map((lead) => lead.creative_id),
  );

  let assigned = 0;
  // Сколько карточек уже ушло каждому в этот заход: пачку из двадцати заявок
  // нельзя вываливать в чат подряд — работать с такой лентой невозможно.
  const sentTo = new Map<string, number>();

  for (const lead of queue) {
    // Пересортировка на каждом шаге: иначе весь пакет уйдёт одному человеку.
    managers.sort(byFairness);

    const target = managers.find((manager) => manager.open < company.max_open_leads);
    if (!target) break;

    const alreadySent = sentTo.get(target.id) ?? 0;

    const ok = await assignTo(
      supabase,
      company,
      { ...lead, creativeLabel: lead.creative_id ? (labels.get(lead.creative_id) ?? null) : null },
      target,
      'auto',
      alreadySent < CARDS_PER_RUN,
    );
    if (!ok) continue;

    sentTo.set(target.id, alreadySent + 1);
    target.received += 1;
    target.open += 1;
    target.lastAssignedAt = Date.now();
    assigned += 1;
  }

  // Про остальные — одна строка вместо десятка карточек.
  for (const [managerId, count] of sentTo) {
    if (count <= CARDS_PER_RUN) continue;
    const manager = managers.find((item) => item.id === managerId);
    if (!manager?.telegram_user_id) continue;

    const rest = count - CARDS_PER_RUN;
    await sendMessage(
      manager.telegram_user_id,
      `📥 Вам назначено ещё ${rest} ${plural(rest, 'клиент', 'клиента', 'клиентов')}.\nОткройте «Мои лиды» — они пойдут по одному.`,
    );
  }

  return { assigned, queued: queue.length - assigned };
}

/** Сколько карточек за один заход присылать подряд, прежде чем свести в итог. */
const CARDS_PER_RUN = 3;

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Названия объявлений для карточки: менеджеру важно, на что человек откликнулся. */
async function creativeLabels(
  supabase: Admin,
  companyId: string,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();

  const { data } = await supabase
    .from('creatives')
    .select('id, label, name')
    .eq('company_id', companyId)
    .in('id', unique);

  return new Map((data ?? []).map((row) => [row.id, row.label || row.name] as const));
}

/** Назначение одного лида: запись, журнал и сообщение в Telegram. */
async function assignTo(
  supabase: Admin,
  company: CompanySettings,
  lead: {
    id: string;
    name: string;
    phone: string | null;
    source: string | null;
    platform: string | null;
    status: string;
    creativeLabel: string | null;
    touch_count?: number;
  },
  manager: Candidate,
  reason: 'auto' | 'manual',
  /** Слать ли карточку: при большой пачке остальные сводятся в одну строку. */
  notify = true,
): Promise<boolean> {
  const now = new Date().toISOString();

  // Условие assigned_to is null защищает от гонки: если лид успели забрать
  // параллельным запуском, обновление просто ничего не затронет — один номер
  // физически не может достаться двум менеджерам.
  const { data: updated } = await supabase
    .from('leads')
    .update({ assigned_to: manager.id, assigned_at: now })
    .eq('id', lead.id)
    .eq('company_id', company.id)
    .is('assigned_to', null)
    .select('id');

  if (!updated || updated.length === 0) return false;

  await supabase.from('lead_assignments').insert({
    company_id: company.id,
    lead_id: lead.id,
    employee_id: manager.id,
    assigned_at: now,
    reason,
  });

  if (manager.telegram_user_id && notify) {
    const funnelType: FunnelType = company.funnel_type === 'direct' ? 'direct' : 'trial';
    await sendMessage(
      manager.telegram_user_id,
      leadCard(
        { ...lead, creativeLabel: lead.creativeLabel },
        '🔔 <b>Новый клиент</b>',
      ),
      {
        inline: [
            ...statusButtons(lead.id, funnelType),
        ],
      },
    );
  }

  return true;
}
