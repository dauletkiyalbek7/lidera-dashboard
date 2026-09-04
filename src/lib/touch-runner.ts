import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { untilLabel } from '@/lib/lead-touches';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import {
  leadCard,
  statusButtons,
  trialButtons,
  trialOutcomeButtons,
  whatsappButton,
} from '@/lib/telegram-lead-card';
import { formatTrialTime, shortCreativeLabel } from '@/lib/trials';
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

export type TouchRunResult = { reminded: number; lessons: number };

/**
 * За сколько минут до урока напоминать. Три захода: заранее, чтобы успеть
 * подготовиться, и перед самым началом, чтобы не пропустить.
 */
const LESSON_REMINDERS = [60, 30, 10];

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
  const lessons = await remindAboutLessons(supabase);

  return { reminded, lessons };
}

/**
 * Напоминание продажнику перед онлайн-уроком.
 *
 * Урок идёт по видеосвязи и назначается заранее — за час до начала о нём
 * надо напомнить, иначе клиент выйдет на связь, а продажник забудет.
 */
async function remindAboutLessons(supabase: Admin): Promise<number> {
  const now = Date.now();
  const until = new Date(now + LESSON_REMINDERS[0] * 60 * 1000).toISOString();

  const { data: soon } = await supabase
    .from('trials')
    .select('id, company_id, lead_id, assigned_to, starts_at, reminders_sent')
    .eq('status', 'scheduled')
    .not('starts_at', 'is', null)
    .not('assigned_to', 'is', null)
    .lt('reminders_sent', LESSON_REMINDERS.length)
    .gt('starts_at', new Date(now).toISOString())
    .lte('starts_at', until)
    .limit(50);

  if (!soon || soon.length === 0) return 0;

  let sent = 0;

  for (const lesson of soon) {
    if (!lesson.assigned_to || !lesson.lead_id || !lesson.starts_at) continue;

    const minutes = Math.round((new Date(lesson.starts_at).getTime() - now) / 60000);

    // Сколько напоминаний должно было уйти к этому моменту. Если сервер спал
    // и пропустил час, за раз отправится одно — последнее уместное.
    const due = LESSON_REMINDERS.filter((mark) => minutes <= mark).length;
    if (due <= lesson.reminders_sent) continue;

    // Отметку ставим до отправки: повтор раздражает сильнее, чем пропуск.
    await supabase
      .from('trials')
      .update({ reminders_sent: due, reminded_at: new Date().toISOString() })
      .eq('id', lesson.id);

    const chatId = await telegramOf(supabase, lesson.assigned_to);
    if (!chatId) continue;

    const [{ data: lead }, { data: company }] = await Promise.all([
      supabase
        .from('leads')
        .select('name, phone, source, platform, status, creative_id')
        .eq('id', lesson.lead_id)
        .maybeSingle(),
      supabase
        .from('companies')
        .select('timezone')
        .eq('id', lesson.company_id)
        .maybeSingle(),
    ]);

    if (!lead) continue;

    const timeZone = company?.timezone ?? 'Asia/Almaty';
    const creativeName = await shortCreativeLabel(supabase, lesson.company_id, lead.creative_id);

    await sendMessage(
      chatId,
      leadCard(
        { ...lead, creativeLabel: creativeName },
        `⏰ <b>Урок через ${Math.max(1, minutes)} мин</b>\n🕒 ${formatTrialTime(lesson.starts_at, timeZone)}`,
      ),
      { inline: [...trialButtons(lesson.id), ...whatsappButton(lead.phone)] },
    );

    sent += 1;
  }

  return sent;
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

    // Обещание вернуться даёт и менеджер, и продажник после урока. Кнопки под
    // напоминанием должны быть те, которые сотрудник вправе нажать: у хозяина
    // заявки это статусы разговора, у продажника — исход его урока. Иначе
    // напоминание приходит с кнопками, отвечающими «этот клиент не за вами».
    const own = context.lead.assigned_to === touch.employee_id;
    const trialId = own
      ? null
      : await trialOf(supabase, touch.company_id, touch.lead_id, touch.employee_id);

    if (!own && !trialId) continue;

    await sendMessage(chatId, leadCard(context.lead, header, context.trialTerm), {
      inline: [
        ...(trialId
          ? trialOutcomeButtons(trialId)
          : statusButtons(touch.lead_id, context.funnelType, context.trialTerm)),
        ...whatsappButton(context.lead.phone),
      ],
    });

    sent += 1;
  }

  return sent;
}

// -----------------------------------------------------------------------------
// Лиды, к которым не притронулись
// -----------------------------------------------------------------------------

/** Статусы, при которых лид ещё в работе и напоминания уместны. */
const OPEN_STATUSES = ['new', 'no_answer', 'thinking'];

// -----------------------------------------------------------------------------
// Общее
// -----------------------------------------------------------------------------

async function leadContext(supabase: Admin, companyId: string, leadId: string) {
  const [{ data: lead }, { data: company }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, name, phone, source, platform, status, assigned_to')
      .eq('id', leadId)
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('companies')
      .select('funnel_type, timezone, trial_term')
      .eq('id', companyId)
      .maybeSingle(),
  ]);

  if (!lead) return null;

  return {
    lead,
    funnelType: (company?.funnel_type === 'direct' ? 'direct' : 'trial') as FunnelType,
    timezone: company?.timezone ?? 'Asia/Almaty',
    // Промежуточный шаг каждая компания зовёт по-своему: у школы «Пробный»,
    // у Дарына «Вебинар». В напоминании подпись обязана совпадать с кнопкой.
    trialTerm: company?.trial_term,
  };
}

/** Урок этого клиента, закреплённый за этим сотрудником. */
async function trialOf(
  supabase: Admin,
  companyId: string,
  leadId: string,
  employeeId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('trials')
    .select('id')
    .eq('company_id', companyId)
    .eq('lead_id', leadId)
    .eq('assigned_to', employeeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
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
