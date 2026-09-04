import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminSupabase } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import { leadCard, trialButtons, whatsappButton } from '@/lib/telegram-lead-card';
import { formatTrialTime, shortCreativeLabel } from '@/lib/trials';

/**
 * Напоминание об уроке.
 *
 * Работа одна и идёт раз в минуту из базы (pg_cron): за час, за полчаса и за
 * десять минут до занятия предупредить продажника. Урок идёт по видеосвязи и
 * назначается заранее — без напоминания клиент выйдет на связь, а продажник
 * забудет.
 *
 * Менеджеру бот не напоминает ничего. Обещания «перезвоню вечером» отсюда
 * убраны вместе с кнопкой, которой их ставили: она стояла на пути и мешала
 * отмечать статус одним касанием, а клиент и без будильника не теряется — он
 * лежит в своей пачке в «Моих клиентах», куда менеджер и так заходит.
 *
 * Работает сервисным ключом: у планировщика нет пользовательской сессии,
 * поэтому company_id проверяется в каждом запросе вручную.
 */

type Admin = SupabaseClient<Database>;

export type TouchRunResult = { lessons: number };

/**
 * За сколько минут до урока напоминать. Три захода: заранее, чтобы успеть
 * подготовиться, и перед самым началом, чтобы не пропустить.
 */
const LESSON_REMINDERS = [60, 30, 10];

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

  return { lessons: await remindAboutLessons(supabase) };
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