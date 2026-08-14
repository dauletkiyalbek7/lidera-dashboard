import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { zonedIsoDate } from '@/lib/period';
import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import { copyPhoneButton, leadCard, trialButtons } from '@/lib/telegram-lead-card';
import { wasHeld } from '@/lib/trial-status';

/**
 * Запись на пробное занятие.
 *
 * Статус лида и раздел «Пробные» должны совпадать: иначе менеджер отмечает
 * «Пробный», а у продажника пусто, и занятие приходится заводить вручную
 * вторым действием. Поэтому запись создаётся из одного места — и когда статус
 * меняют в кабинете, и когда его нажимают кнопкой в боте.
 */

type Admin = SupabaseClient<Database>;

/**
 * Привести раздел «Пробные» в соответствие со статусом лида.
 * Возвращает идентификатор записи, если она появилась только что.
 */
export async function syncTrialForLead(
  supabase: Admin,
  input: { companyId: string; leadId: string; status: string; timezone: string },
): Promise<{ createdId: string | null }> {
  if (input.status !== 'trial' && input.status !== 'sale') return { createdId: null };

  const { data: existing } = await supabase
    .from('trials')
    .select('id, status')
    .eq('company_id', input.companyId)
    .eq('lead_id', input.leadId)
    .maybeSingle();

  if (!existing && input.status === 'trial') {
    // Время урока согласовывает менеджер с клиентом, поэтому черновик
    // создаётся без него: в разделе «Пробные» он висит как «нужно назначить
    // время и продажника» — так запись не теряется и не выдумывается сама.
    const { data: created } = await supabase
      .from('trials')
      .insert({
        company_id: input.companyId,
        lead_id: input.leadId,
        date: zonedIsoDate(new Date(), input.timezone),
        status: 'scheduled',
      })
      .select('id')
      .maybeSingle();

    return { createdId: created?.id ?? null };
  }

  // Купил курс — значит урок состоялся: до продажи иначе не доходят.
  if (input.status === 'sale' && existing && !wasHeld(existing.status)) {
    await supabase.from('trials').update({ status: 'sale' }).eq('id', existing.id);
  }

  return { createdId: null };
}

/**
 * Кто из продажников занят в это время.
 *
 * Урок идёт по видеосвязи и длится час, поэтому «занят» — это пересечение с
 * уже назначенным уроком. Менеджер согласовывает время с клиентом и должен
 * сразу видеть, кому его можно отдать, а не выяснять это перепиской.
 */
export const TRIAL_DURATION_MINUTES = 60;

/** «15 августа, 18:00» по времени компании — одинаково в кабинете и в боте. */
export function formatTrialTime(startsAt: Date | string, timeZone: string): string {
  return new Date(startsAt).toLocaleString('ru-RU', {
    timeZone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Карточка урока продажнику: с кем говорить, по какому номеру и когда. */
export async function notifyTrialBooked(
  supabase: Admin,
  companyId: string,
  leadId: string,
  startsAt: Date,
  sellerId: string,
  timeZone: string,
): Promise<void> {
  const [{ data: seller }, { data: lead }] = await Promise.all([
    supabase
      .from('employees')
      .select('telegram_user_id')
      .eq('id', sellerId)
      .maybeSingle(),
    supabase
      .from('leads')
      .select('name, phone, source, platform, status, creative_id')
      .eq('id', leadId)
      .eq('company_id', companyId)
      .maybeSingle(),
  ]);

  if (!seller?.telegram_user_id || !lead) return;

  const { data: creative } = lead.creative_id
    ? await supabase
        .from('creatives')
        .select('label, name')
        .eq('id', lead.creative_id)
        .maybeSingle()
    : { data: null };

  const { data: trial } = await supabase
    .from('trials')
    .select('id')
    .eq('company_id', companyId)
    .eq('lead_id', leadId)
    .eq('assigned_to', sellerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!trial) return;

  await sendMessage(
    seller.telegram_user_id,
    leadCard(
      {
        ...lead,
        creativeLabel: creative?.label || creative?.name || null,
      },
      `🎓 <b>Онлайн-урок</b>\n🕒 ${formatTrialTime(startsAt, timeZone)}\nМенеджер согласовал время — урок за вами.`,
    ),
    { inline: [...copyPhoneButton(lead.phone), ...trialButtons(trial.id)] },
  );
}

export async function sellerAvailability(
  supabase: Admin,
  companyId: string,
  startsAt: Date,
): Promise<{ id: string; fullName: string; busy: boolean; busyAt: string | null }[]> {
  const from = new Date(startsAt.getTime() - TRIAL_DURATION_MINUTES * 60 * 1000);
  const to = new Date(startsAt.getTime() + TRIAL_DURATION_MINUTES * 60 * 1000);

  const [{ data: sellers }, { data: booked }] = await Promise.all([
    supabase
      .from('employees')
      .select('id, full_name')
      .eq('company_id', companyId)
      .eq('role', 'salesperson')
      .eq('status', 'active')
      .order('full_name'),
    supabase
      .from('trials')
      .select('assigned_to, starts_at')
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .not('starts_at', 'is', null)
      .gt('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString()),
  ]);

  const busy = new Map<string, string>();
  for (const trial of booked ?? []) {
    if (trial.assigned_to && trial.starts_at) busy.set(trial.assigned_to, trial.starts_at);
  }

  return (sellers ?? []).map((seller) => ({
    id: seller.id,
    fullName: seller.full_name,
    busy: busy.has(seller.id),
    busyAt: busy.get(seller.id) ?? null,
  }));
}
