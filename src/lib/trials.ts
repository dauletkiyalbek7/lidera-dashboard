import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { zonedIsoDate } from '@/lib/period';
import { instantInZone } from '@/lib/lead-touches';
import { BOOKING_HOURS } from '@/lib/telegram-lead-card';
import { creativeLabel } from '@/lib/creative-label';
import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import { leadCard, trialButtons, whatsappButton } from '@/lib/telegram-lead-card';
import { trialStatusMeta, wasHeld } from '@/lib/trial-status';

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

  // Уроков у клиента бывает несколько: не вышел на связь или отменил — его
  // записывают заново. Берём последний, иначе запрос сломается на втором.
  const { data: existing } = await supabase
    .from('trials')
    .select('id, status')
    .eq('company_id', input.companyId)
    .eq('lead_id', input.leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Прошлый урок закрыт — значит это новая попытка, и ей нужна своя запись:
  // иначе «не вышел на связь» навсегда закрывал бы клиенту дорогу к уроку.
  const needsRecord =
    input.status === 'trial' && (!existing || trialStatusMeta(existing.status).closed);

  if (needsRecord) {
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

/**
 * Короткое имя объявления — ровно то же, что в кабинете: «Видео 11».
 *
 * Номер это место креатива в списке компании по дате создания, поэтому одной
 * строкой из базы его не получить — нужен весь список. Иначе продажник видит
 * длинное имя из Ads Manager, а директор в отчёте короткое.
 */
export async function shortCreativeLabel(
  supabase: Admin,
  companyId: string,
  creativeId: string | null,
): Promise<string | null> {
  if (!creativeId) return null;

  const { data } = await supabase
    .from('creatives')
    .select('id, label, format, created_at')
    .eq('company_id', companyId)
    .order('created_at')
    .order('id');

  const index = (data ?? []).findIndex((row) => row.id === creativeId);
  if (index < 0) return null;

  return creativeLabel(data![index], index + 1);
}

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
): Promise<{ delivered: boolean; reason?: string }> {
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

  if (!lead) return { delivered: false, reason: 'заявка не найдена' };
  if (!seller?.telegram_user_id) {
    return { delivered: false, reason: 'у продажника не подключён Telegram' };
  }

  const creativeName = await shortCreativeLabel(supabase, companyId, lead.creative_id);

  const { data: trial } = await supabase
    .from('trials')
    .select('id')
    .eq('company_id', companyId)
    .eq('lead_id', leadId)
    .eq('assigned_to', sellerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!trial) return { delivered: false, reason: 'запись урока не найдена' };

  await sendMessage(
    seller.telegram_user_id,
    leadCard(
      {
        ...lead,
        creativeLabel: creativeName,
      },
      `🎓 <b>Онлайн-урок</b>\n🕒 ${formatTrialTime(startsAt, timeZone)}\nМенеджер согласовал время — урок за вами.`,
    ),
    { inline: [...trialButtons(trial.id), ...whatsappButton(lead.phone)] },
  );

  return { delivered: true };
}

/**
 * Часы дня с пометкой, свободен ли час.
 *
 * Занятые не выкидываются из списка, а показываются замком. Менеджер
 * разговаривает с клиентом и называет ему время вслух: пропуск в сетке он
 * читает как «такого времени у нас нет», а замок — как «это уже занято,
 * давайте соседнее». Вторая новость честнее и короче.
 *
 * Час занят, только если заняты все продажники: пока хоть кто-то свободен,
 * урок есть кому провести.
 *
 * Рабочий график здесь намеренно не учитывается — отдел работает без
 * выходных, см. `hasSellers` ниже и историю решения в CLAUDE.md.
 */
export type DaySlot = { time: string; free: boolean };

export async function daySlots(
  supabase: Admin,
  companyId: string,
  date: string,
  timeZone: string,
  options?: { exceptTrialId?: string; after?: string },
): Promise<{ slots: DaySlot[]; hasSellers: boolean }> {
  const [{ data: sellers }, { data: booked }] = await Promise.all([
    supabase
      .from('employees')
      .select('id')
      .eq('company_id', companyId)
      .eq('role', 'salesperson')
      .eq('status', 'active'),
    supabase
      .from('trials')
      .select('id, assigned_to, starts_at')
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .eq('date', date)
      .not('starts_at', 'is', null)
      .not('assigned_to', 'is', null),
  ]);

  if (!sellers || sellers.length === 0) return { slots: [], hasSellers: false };

  const busy = (booked ?? []).filter((trial) => trial.id !== options?.exceptTrialId);

  const slots = BOOKING_HOURS
    // Прошедшие часы — не «занято», а «уже не будет»: замок про них врал бы.
    .filter((time) => !options?.after || time > options.after)
    .map((time) => {
      const startsAt = instantInZone(date, time, timeZone);
      if (!startsAt) return { time, free: false };

      const free = sellers.some((seller) => !isBusy(busy, seller.id, startsAt));
      return { time, free };
    });

  return { slots, hasSellers: true };
}

/** Урок идёт час, поэтому занятость — это пересечение, а не совпадение минут. */
function isBusy(
  booked: { assigned_to: string | null; starts_at: string | null }[],
  sellerId: string,
  startsAt: Date,
): boolean {
  return booked.some(
    (trial) =>
      trial.assigned_to === sellerId &&
      trial.starts_at !== null &&
      Math.abs(new Date(trial.starts_at).getTime() - startsAt.getTime()) <
        TRIAL_DURATION_MINUTES * 60 * 1000,
  );
}

/**
 * Кому отдать урок в это время.
 *
 * Продажника выбирает не менеджер, а система: менеджер продал урок и должен
 * вернуться к клиенту с готовым ответом, а не выбирать из списка людей,
 * которых он в лицо не знает. Заодно это снимает вопрос «почему все уроки
 * достаются одному» — очередь считается по числу уже выданных занятий.
 *
 * Порядок: сначала тот, у кого уроков меньше; при равенстве — тот, кто дольше
 * всех их не получал. То же правило, что и в раздаче лидов менеджерам.
 */
export async function pickSellerForTrial(
  supabase: Admin,
  companyId: string,
  startsAt: Date,
  exceptTrialId?: string,
): Promise<{ id: string; fullName: string } | null> {
  const from = new Date(startsAt.getTime() - TRIAL_DURATION_MINUTES * 60 * 1000);
  const to = new Date(startsAt.getTime() + TRIAL_DURATION_MINUTES * 60 * 1000);
  const since = new Date(Date.now() - FAIRNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [{ data: sellers }, { data: overlapping }, { data: history }] = await Promise.all([
    supabase
      .from('employees')
      .select('id, full_name')
      .eq('company_id', companyId)
      .eq('role', 'salesperson')
      .eq('status', 'active')
      .order('full_name'),
    supabase
      .from('trials')
      .select('id, assigned_to, starts_at')
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .not('starts_at', 'is', null)
      .gt('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString()),
    supabase
      .from('trials')
      .select('assigned_to, assigned_at')
      .eq('company_id', companyId)
      .not('assigned_to', 'is', null)
      .gte('assigned_at', since.toISOString()),
  ]);

  if (!sellers || sellers.length === 0) return null;

  const taken = new Set(
    (overlapping ?? [])
      .filter((trial) => trial.id !== exceptTrialId && trial.assigned_to)
      .map((trial) => trial.assigned_to as string),
  );

  const received = new Map<string, number>();
  const lastAt = new Map<string, number>();

  for (const row of history ?? []) {
    if (!row.assigned_to) continue;
    received.set(row.assigned_to, (received.get(row.assigned_to) ?? 0) + 1);
    const at = row.assigned_at ? new Date(row.assigned_at).getTime() : 0;
    if (at > (lastAt.get(row.assigned_to) ?? 0)) lastAt.set(row.assigned_to, at);
  }

  const free = sellers
    .filter((seller) => !taken.has(seller.id))
    .sort(
      (a, b) =>
        (received.get(a.id) ?? 0) - (received.get(b.id) ?? 0) ||
        (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0),
    );

  const chosen = free[0];
  return chosen ? { id: chosen.id, fullName: chosen.full_name } : null;
}

/** За какой срок считаем очередь: месяц ровно ложится на смену состава отдела. */
const FAIRNESS_WINDOW_DAYS = 30;

export async function sellerAvailability(
  supabase: Admin,
  companyId: string,
  startsAt: Date,
  /**
   * Урок, который сейчас записываем. Сам себя он занятым делать не должен:
   * иначе после первого назначения ни продажника, ни время уже не поменять —
   * список показал бы всех занятыми.
   */
  exceptTrialId?: string,
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
      .select('id, assigned_to, starts_at')
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .not('starts_at', 'is', null)
      .gt('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString()),
  ]);

  const busy = new Map<string, string>();
  for (const trial of booked ?? []) {
    if (trial.id === exceptTrialId) continue;
    if (trial.assigned_to && trial.starts_at) busy.set(trial.assigned_to, trial.starts_at);
  }

  return (sellers ?? []).map((seller) => ({
    id: seller.id,
    fullName: seller.full_name,
    busy: busy.has(seller.id),
    busyAt: busy.get(seller.id) ?? null,
  }));
}
