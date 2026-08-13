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
 *   1. лид получает только тот, кто открыл смену — смена и есть выключатель;
 *   2. лид идёт наименее загруженному, при равенстве — тому, кто дольше всех
 *      не получал; так очередь выравнивается сама и не зависит от порядка имён;
 *   3. если за sla_minutes лид не тронут, он возвращается в очередь и уходит
 *      другому. Без этого правила раздача превращается в «упало в чат и умерло».
 *
 * Запускается из трёх мест: при создании лида, при открытии смены и раз в
 * минуту из базы (pg_cron). Функции идемпотентны: повторный запуск ничего
 * не ломает, поэтому дублирующийся вызов безопасен.
 *
 * Работает сервисным ключом — у бота и у планировщика нет пользовательской
 * сессии, поэтому RLS здесь не работает и каждый запрос сам ограничен company_id.
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
  reclaimed: number;
  queued: number;
};

/** Раздача по одной компании: сначала забрать просроченное, потом раздать очередь. */
export async function runDistribution(companyId: string): Promise<DistributionResult> {
  const supabase = createAdminSupabase();

  const { data: company } = await supabase
    .from('companies')
    .select(
      'id, funnel_type, auto_assign, max_open_leads, sla_minutes, shift_mode, work_start_time, work_end_time, work_days, late_grace_minutes',
    )
    .eq('id', companyId)
    .maybeSingle();

  if (!company || !company.auto_assign) {
    return { assigned: 0, reclaimed: 0, queued: 0 };
  }

  const reclaimed = await reclaimOverdue(supabase, company);
  const { assigned, queued } = await distributeQueue(supabase, company);

  return { assigned, reclaimed, queued };
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

  const totals = { assigned: 0, reclaimed: 0, queued: 0, companies: 0 };

  for (const company of companies ?? []) {
    const result = await runDistribution(company.id);
    totals.assigned += result.assigned;
    totals.reclaimed += result.reclaimed;
    totals.queued += result.queued;
    totals.companies += 1;
  }

  return totals;
}

type CompanySettings = {
  id: string;
  funnel_type: string;
  max_open_leads: number;
  sla_minutes: number;
  shift_mode: string;
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  late_grace_minutes: number;
};

/**
 * Кому можно отдать лид: активный менеджер с открытой сменой, у которого
 * ещё есть место. Возвращается отсортированным — первый и есть получатель.
 */
async function eligibleManagers(supabase: Admin, company: CompanySettings) {
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
    supabase.from('shifts').select('employee_id').in('employee_id', ids).is('ended_at', null),
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
      .order('assigned_at', { ascending: false })
      .limit(500),
  ]);

  const onShift = new Set((openShifts ?? []).map((shift) => shift.employee_id));

  const load = new Map<string, number>();
  for (const lead of activeLeads ?? []) {
    if (lead.assigned_to) load.set(lead.assigned_to, (load.get(lead.assigned_to) ?? 0) + 1);
  }

  // Первая запись по сотруднику — самая свежая: список уже отсортирован.
  const lastAssigned = new Map<string, number>();
  for (const row of history ?? []) {
    if (!lastAssigned.has(row.employee_id)) {
      lastAssigned.set(row.employee_id, new Date(row.assigned_at).getTime());
    }
  }

  // Режим считается по каждому отдельно: в одной компании уживаются офисные
  // менеджеры со сменами и удалённые, которым отмечаться не нужно.
  return employees
    .filter(
      (employee) =>
        resolveShiftRules(employee, company).mode === 'always' || onShift.has(employee.id),
    )
    .map((employee) => ({
      ...employee,
      load: load.get(employee.id) ?? 0,
      lastAssignedAt: lastAssigned.get(employee.id) ?? 0,
    }))
    .filter((employee) => employee.load < company.max_open_leads)
    .sort((a, b) => a.load - b.load || a.lastAssignedAt - b.lastAssignedAt);
}

/** Раздать всё, что лежит без ответственного. Порядок — от самых старых. */
async function distributeQueue(supabase: Admin, company: CompanySettings) {
  const { data: queue } = await supabase
    .from('leads')
    .select('id, name, phone, source, platform, status')
    .eq('company_id', company.id)
    .is('assigned_to', null)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: true })
    .limit(100);

  if (!queue || queue.length === 0) return { assigned: 0, queued: 0 };

  const managers = await eligibleManagers(supabase, company);
  if (managers.length === 0) return { assigned: 0, queued: queue.length };

  const previousOwner = await ownersBeforeReclaim(
    supabase,
    queue.map((lead) => lead.id),
  );

  let assigned = 0;

  for (const lead of queue) {
    // Пересортировка на каждом шаге: иначе весь пакет уйдёт одному человеку.
    managers.sort((a, b) => a.load - b.load || a.lastAssignedAt - b.lastAssignedAt);

    const free = managers.filter((manager) => manager.load < company.max_open_leads);
    // Лид, забранный по SLA, возвращать тому же человеку бессмысленно —
    // он его уже проигнорировал. Отдаём другому, и только если других
    // свободных нет, оставляем прежнему: лучше так, чем лежать в очереди.
    const previous = previousOwner.get(lead.id);
    const target = free.find((manager) => manager.id !== previous) ?? free[0];
    if (!target) break;

    const ok = await assignTo(supabase, company, lead, target, 'auto');
    if (!ok) continue;

    target.load += 1;
    target.lastAssignedAt = Date.now();
    assigned += 1;
  }

  return { assigned, queued: queue.length - assigned };
}

/** Кто держал лид до возврата по SLA — чтобы не отдать его тому же человеку. */
async function ownersBeforeReclaim(
  supabase: Admin,
  leadIds: string[],
): Promise<Map<string, string>> {
  if (leadIds.length === 0) return new Map();

  const { data } = await supabase
    .from('lead_assignments')
    .select('lead_id, employee_id, released_at')
    .in('lead_id', leadIds)
    .eq('reason', 'sla')
    .not('released_at', 'is', null)
    .order('released_at', { ascending: false });

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (!map.has(row.lead_id)) map.set(row.lead_id, row.employee_id);
  }
  return map;
}

/**
 * Забрать лиды, к которым не притронулись за отведённое время.
 * Признак «не тронут» — статус так и остался «новый».
 */
async function reclaimOverdue(supabase: Admin, company: CompanySettings) {
  const deadline = new Date(Date.now() - company.sla_minutes * 60 * 1000).toISOString();

  const { data: overdue } = await supabase
    .from('leads')
    .select('id, assigned_to')
    .eq('company_id', company.id)
    .eq('status', 'new')
    .not('assigned_to', 'is', null)
    .lt('assigned_at', deadline)
    .limit(100);

  if (!overdue || overdue.length === 0) return 0;

  for (const lead of overdue) {
    await supabase
      .from('leads')
      .update({ assigned_to: null, assigned_at: null })
      .eq('id', lead.id)
      .eq('company_id', company.id);

    if (lead.assigned_to) {
      await supabase
        .from('lead_assignments')
        .update({ released_at: new Date().toISOString(), reason: 'sla' })
        .eq('lead_id', lead.id)
        .eq('employee_id', lead.assigned_to)
        .is('released_at', null);
    }
  }

  return overdue.length;
}

type Manager = { id: string; full_name: string; telegram_user_id: number | null };

/** Назначение одного лида: запись, журнал и сообщение в Telegram. */
async function assignTo(
  supabase: Admin,
  company: CompanySettings,
  lead: { id: string; name: string; phone: string | null; source: string | null; platform: string | null; status: string },
  manager: Manager,
  reason: 'auto' | 'manual',
): Promise<boolean> {
  const now = new Date().toISOString();

  // Условие assigned_to is null защищает от гонки: если лид успели забрать
  // параллельным запуском, обновление просто ничего не затронет.
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

  if (manager.telegram_user_id) {
    const funnelType: FunnelType = company.funnel_type === 'direct' ? 'direct' : 'trial';
    await sendMessage(
      manager.telegram_user_id,
      leadCard(lead, '🔔 <b>Новый лид</b>'),
      { inline: statusButtons(lead.id, funnelType) },
    );
  }

  return true;
}
