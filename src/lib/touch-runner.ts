import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { untilLabel } from '@/lib/lead-touches';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import { leadCard, touchButtons, statusButtons } from '@/lib/telegram-lead-card';
import type { FunnelType } from '@/lib/metrics';

/**
 * Напоминания о касаниях.
 *
 * Две работы, обе идут раз в минуту из базы (pg_cron):
 *   1. наступило время обещания «перезвоню вечером» — напомнить менеджеру;
 *   2. лид висит нетронутым дольше положенного — подтолкнуть.
 *
 * Лид при этом никуда не уходит: напоминание адресуется тому же человеку.
 * Если менеджер молчит и после напоминаний, это видно РОПу в отчёте — решение
 * принимает он, а не автоматика.
 *
 * Работает сервисным ключом: у планировщика нет пользовательской сессии,
 * поэтому company_id проверяется в каждом запросе вручную.
 */

type Admin = SupabaseClient<Database>;

export type TouchRunResult = { reminded: number; nudged: number };

/** Одно касание в базе + обновление лида. Возвращает время напоминания. */
export async function scheduleTouch(
  supabase: Admin,
  input: {
    companyId: string;
    leadId: string;
    employeeId: string | null;
    remindAt: Date;
    kind?: 'promise' | 'note';
    note?: string | null;
    /** Считать ли это безрезультатной попыткой дозвона. */
    countsAsAttempt?: boolean;
  },
): Promise<void> {
  const now = new Date().toISOString();

  // Прежнее обещание закрываем: у лида всегда ровно одно ближайшее касание,
  // иначе менеджеру придут два напоминания об одном и том же.
  await closeOpenTouches(supabase, input.leadId);

  await supabase.from('lead_touches').insert({
    company_id: input.companyId,
    lead_id: input.leadId,
    employee_id: input.employeeId,
    kind: input.kind ?? 'promise',
    remind_at: input.remindAt.toISOString(),
    note: input.note ?? null,
  });

  const { data: lead } = await supabase
    .from('leads')
    .select('touch_count')
    .eq('id', input.leadId)
    .maybeSingle();

  await supabase
    .from('leads')
    .update({
      next_touch_at: input.remindAt.toISOString(),
      last_touch_at: now,
      touch_count: (lead?.touch_count ?? 0) + (input.countsAsAttempt ? 1 : 0),
    })
    .eq('id', input.leadId)
    .eq('company_id', input.companyId);
}

/** Закрыть незавершённые касания лида — статус сдвинулся, напоминать не о чем. */
export async function closeOpenTouches(supabase: Admin, leadId: string): Promise<void> {
  await supabase
    .from('lead_touches')
    .update({ done_at: new Date().toISOString() })
    .eq('lead_id', leadId)
    .is('done_at', null);

  await supabase.from('leads').update({ next_touch_at: null }).eq('id', leadId);
}

/** Проход планировщика по всем компаниям. */
export async function runTouchReminders(): Promise<TouchRunResult> {
  const supabase = createAdminSupabase();

  const reminded = await sendDueReminders(supabase);
  const nudged = await nudgeUntouched(supabase);

  return { reminded, nudged };
}

// -----------------------------------------------------------------------------
// Обещания, время которых пришло
// -----------------------------------------------------------------------------

async function sendDueReminders(supabase: Admin): Promise<number> {
  const now = new Date();

  const { data: due } = await supabase
    .from('lead_touches')
    .select('id, company_id, lead_id, employee_id, remind_at, note')
    .lte('remind_at', now.toISOString())
    .is('notified_at', null)
    .is('done_at', null)
    .order('remind_at', { ascending: true })
    .limit(100);

  if (!due || due.length === 0) return 0;

  let sent = 0;

  for (const touch of due) {
    // Отметку ставим до отправки: если Telegram не ответит, повтор попытки
    // хуже пропуска — менеджер получит одно и то же напоминание много раз.
    await supabase
      .from('lead_touches')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', touch.id);

    if (!touch.employee_id) continue;

    const context = await leadContext(supabase, touch.company_id, touch.lead_id);
    if (!context) continue;

    // Лид уже двинулся дальше — напоминание не нужно.
    if (!OPEN_STATUSES.includes(context.lead.status)) continue;

    const chatId = await telegramOf(supabase, touch.employee_id);
    if (!chatId) continue;

    const promised = touch.remind_at
      ? new Date(touch.remind_at).toLocaleString('ru-RU', {
          timeZone: context.timezone,
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    const header = [
      '⏰ <b>Пора перезвонить</b>',
      promised ? `Вы обещали связаться: ${promised}` : null,
      touch.note ? `Заметка: ${touch.note}` : null,
    ]
      .filter((line) => line !== null)
      .join('\n');

    await sendMessage(chatId, leadCard(context.lead, header), {
      inline: statusButtons(touch.lead_id, context.funnelType),
    });

    sent += 1;
  }

  return sent;
}

// -----------------------------------------------------------------------------
// Лиды, к которым не притронулись
// -----------------------------------------------------------------------------

/** Статусы, при которых лид ещё в работе и напоминания уместны. */
const OPEN_STATUSES = ['new', 'no_answer', 'contacted', 'in_progress', 'thinking'];

/**
 * Лид назначен, но статус так и остался «новый» дольше положенного.
 * Раньше такой лид отбирали; теперь просто напоминаем — и только тому же
 * менеджеру, не чаще одного раза за тот же срок.
 */
async function nudgeUntouched(supabase: Admin): Promise<number> {
  const { data: companies } = await supabase
    .from('companies')
    .select('id, sla_minutes, funnel_type, timezone')
    .eq('status', 'active')
    .eq('auto_assign', true);

  let sent = 0;

  for (const company of companies ?? []) {
    const deadline = new Date(Date.now() - company.sla_minutes * 60 * 1000).toISOString();

    const { data: stale } = await supabase
      .from('leads')
      .select('id, name, phone, source, platform, status, assigned_to, assigned_at')
      .eq('company_id', company.id)
      .eq('status', 'new')
      .not('assigned_to', 'is', null)
      .lt('assigned_at', deadline)
      .limit(50);

    if (!stale || stale.length === 0) continue;

    // Кому уже напоминали за последний срок — второй раз не трогаем.
    const { data: recent } = await supabase
      .from('lead_touches')
      .select('lead_id')
      .in(
        'lead_id',
        stale.map((lead) => lead.id),
      )
      .eq('kind', 'nudge')
      .gt('notified_at', deadline);

    const alreadyNudged = new Set((recent ?? []).map((row) => row.lead_id));
    const funnelType: FunnelType = company.funnel_type === 'direct' ? 'direct' : 'trial';

    for (const lead of stale) {
      if (alreadyNudged.has(lead.id) || !lead.assigned_to) continue;

      const chatId = await telegramOf(supabase, lead.assigned_to);
      if (!chatId) continue;

      const waiting = lead.assigned_at
        ? Math.round((Date.now() - new Date(lead.assigned_at).getTime()) / 60000)
        : 0;

      await supabase.from('lead_touches').insert({
        company_id: company.id,
        lead_id: lead.id,
        employee_id: lead.assigned_to,
        kind: 'nudge',
        notified_at: new Date().toISOString(),
        done_at: new Date().toISOString(),
        note: `Лид ждёт ${waiting} мин`,
      });

      await sendMessage(
        chatId,
        leadCard(
          lead,
          `⏳ <b>Лид ждёт ${waiting} мин</b>\nОн закреплён за вами и никуда не уйдёт — но чем позже звонок, тем холоднее клиент.`,
        ),
        { inline: [...statusButtons(lead.id, funnelType), ...touchButtons(lead.id)] },
      );

      sent += 1;
    }
  }

  return sent;
}

// -----------------------------------------------------------------------------
// Общее
// -----------------------------------------------------------------------------

async function leadContext(supabase: Admin, companyId: string, leadId: string) {
  const [{ data: lead }, { data: company }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, name, phone, source, platform, status')
      .eq('id', leadId)
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('companies')
      .select('funnel_type, timezone')
      .eq('id', companyId)
      .maybeSingle(),
  ]);

  if (!lead) return null;

  return {
    lead,
    funnelType: (company?.funnel_type === 'direct' ? 'direct' : 'trial') as FunnelType,
    timezone: company?.timezone ?? 'Asia/Almaty',
  };
}

async function telegramOf(supabase: Admin, employeeId: string): Promise<number | null> {
  const { data } = await supabase
    .from('employees')
    .select('telegram_user_id, status')
    .eq('id', employeeId)
    .maybeSingle();

  if (!data || data.status !== 'active') return null;
  return data.telegram_user_id ?? null;
}

/** Подпись «через сколько» для сообщений бота. */
export { untilLabel };
