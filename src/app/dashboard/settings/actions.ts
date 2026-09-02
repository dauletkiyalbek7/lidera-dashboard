'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  AUTOMATIC_ATTENDANCE_STATUSES,
  SHIFT_MODE_ORDER,
  isAttendanceStatus,
  parseWorkDays,
} from '@/lib/attendance';
import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { isValidPoint } from '@/lib/geo';
import { REPORT_SECTIONS, sendReportNow } from '@/lib/group-report';
import { createServerSupabase } from '@/lib/supabase/server';
import { TRIAL_TERM_ORDER } from '@/lib/trial-term';

export type SettingsState = { error?: string; success?: string };

const companySchema = z.object({
  name: z.string().trim().min(2, 'Название слишком короткое').max(120),
  director_name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  funnel_type: z.enum(['trial', 'direct']),
  trial_term: z.enum(TRIAL_TERM_ORDER),
  currency: z.enum(['KZT', 'USD', 'EUR', 'RUB']),
  sales_currency: z.enum(['KZT', 'USD', 'EUR', 'RUB']),
});

/** Реквизиты компании правит только директор — это же ограничение стоит в RLS. */
export async function updateCompany(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { company, profile, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  if (profile.role !== 'DIRECTOR') {
    return { error: 'Изменять данные компании может только директор.' };
  }

  const parsed = companySchema.safeParse({
    name: formData.get('name'),
    director_name: formData.get('director_name'),
    phone: formData.get('phone'),
    funnel_type: formData.get('funnel_type'),
    trial_term: formData.get('trial_term') ?? 'trial',
    currency: formData.get('currency') ?? 'KZT',
    sales_currency: formData.get('sales_currency') ?? 'KZT',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('companies')
    .update({
      name: parsed.data.name,
      director_name: parsed.data.director_name || null,
      phone: parsed.data.phone || null,
      funnel_type: parsed.data.funnel_type,
      trial_term: parsed.data.trial_term,
      currency: parsed.data.currency,
      sales_currency: parsed.data.sales_currency,
    })
    .eq('id', company.id);

  if (error) {
    return { error: 'Не удалось сохранить изменения.' };
  }

  revalidatePath('/dashboard', 'layout');
  return { success: 'Данные компании обновлены.' };
}

const distributionSchema = z.object({
  auto_assign: z.boolean(),
});

/**
 * Настройки авто-раздачи. От них зависит поведение очереди, поэтому они в
 * руках директора: в разных нишах и «быстро» значит разное.
 */
export async function updateDistribution(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { company, profile, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  if (profile.role !== 'DIRECTOR') {
    return { error: 'Менять правила раздачи может только директор.' };
  }

  const parsed = distributionSchema.safeParse({
    auto_assign: formData.get('auto_assign') === 'on',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('companies')
    .update(parsed.data)
    .eq('id', company.id);

  if (error) return { error: 'Не удалось сохранить настройки раздачи.' };

  revalidatePath('/dashboard', 'layout');
  return { success: 'Правила раздачи сохранены.' };
}

const shiftSchema = z.object({
  shift_mode: z.enum(SHIFT_MODE_ORDER),
  office_lat: z.string().trim(),
  office_lng: z.string().trim(),
  office_radius_m: z.coerce.number().int().min(50, 'Минимум 50 метров').max(5000),
  office_label: z.string().trim().max(160).optional(),
  work_start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Укажите время начала в формате 09:00'),
  work_end_time: z.string().regex(/^\d{2}:\d{2}$/, 'Укажите время конца в формате 18:00'),
  late_grace_minutes: z.coerce.number().int().min(0).max(120),
  timezone: z.string().trim().max(64),
});

/**
 * Режим смены, координаты офиса и рабочее время.
 *
 * Радиус меньше 50 метров не даём поставить осознанно: точность GPS в городе
 * хуже, и сотрудник, стоящий в офисе, получал бы отказ.
 */
export async function updateShiftSettings(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { company, profile, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  if (profile.role !== 'DIRECTOR') {
    return { error: 'Менять режим смены может только директор.' };
  }

  const parsed = shiftSchema.safeParse({
    shift_mode: formData.get('shift_mode'),
    office_lat: formData.get('office_lat') ?? '',
    office_lng: formData.get('office_lng') ?? '',
    office_radius_m: formData.get('office_radius_m'),
    office_label: formData.get('office_label'),
    work_start_time: formData.get('work_start_time'),
    work_end_time: formData.get('work_end_time'),
    late_grace_minutes: formData.get('late_grace_minutes'),
    timezone: formData.get('timezone'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const workDays = parseWorkDays(formData.getAll('work_days').map(String));
  if (!workDays) return { error: 'Выберите хотя бы один рабочий день.' };

  if (parsed.data.work_start_time === parsed.data.work_end_time) {
    return { error: 'Начало и конец рабочего дня совпадают.' };
  }

  const lat = parsed.data.office_lat ? Number(parsed.data.office_lat) : null;
  const lng = parsed.data.office_lng ? Number(parsed.data.office_lng) : null;

  if (lat !== null && lng !== null && !isValidPoint(lat, lng)) {
    return { error: 'Координаты выглядят неверно. Проверьте широту и долготу.' };
  }

  if (parsed.data.shift_mode === 'geo' && (lat === null || lng === null)) {
    return { error: 'Для проверки по геолокации нужны координаты офиса.' };
  }

  const statuses = formData.getAll('attendance_statuses').map(String).filter(isAttendanceStatus);
  // Три автоматических статуса выключить нельзя: их ставит сама система по сменам.
  const attendance = Array.from(new Set([...AUTOMATIC_ATTENDANCE_STATUSES, ...statuses]));

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('companies')
    .update({
      shift_mode: parsed.data.shift_mode,
      office_lat: lat,
      office_lng: lng,
      office_radius_m: parsed.data.office_radius_m,
      office_label: parsed.data.office_label || null,
      work_start_time: parsed.data.work_start_time,
      work_end_time: parsed.data.work_end_time,
      work_days: workDays,
      late_grace_minutes: parsed.data.late_grace_minutes,
      timezone: parsed.data.timezone,
      attendance_statuses: attendance,
    })
    .eq('id', company.id);

  if (error) return { error: 'Не удалось сохранить настройки смены.' };

  revalidatePath('/dashboard', 'layout');
  return { success: 'Настройки смены сохранены.' };
}

// -----------------------------------------------------------------------------
// Отчёты в группы Telegram
// -----------------------------------------------------------------------------

const scheduleSchema = z.object({
  chatId: z.string().uuid('Выберите группу'),
  sendAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате 09:30'),
  period: z.enum(['today', 'yesterday', 'week', 'month']),
  sections: z.array(z.enum(REPORT_SECTIONS)).min(1, 'Выберите хотя бы один блок'),
});

/** Добавить время отправки отчёта в группу. */
export async function addReportSchedule(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { company, readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = scheduleSchema.safeParse({
    chatId: formData.get('chatId'),
    sendAt: formData.get('sendAt'),
    period: formData.get('period') ?? 'today',
    sections: formData.getAll('sections'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('report_schedules').insert({
    company_id: company.id,
    chat_id: parsed.data.chatId,
    send_at: `${parsed.data.sendAt}:00`,
    period: parsed.data.period,
    sections: parsed.data.sections,
  });

  if (error) return { error: 'Не удалось сохранить расписание.' };

  revalidatePath('/dashboard/settings');
  return { success: 'Расписание добавлено.' };
}

/** Убрать время отправки. */
export async function removeReportSchedule(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Не указано расписание.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('report_schedules').delete().eq('id', id);

  if (error) return { error: 'Не удалось удалить расписание.' };

  revalidatePath('/dashboard/settings');
  return { success: 'Расписание удалено.' };
}

/**
 * Отправить отчёт в группу прямо сейчас.
 *
 * Нужна не для красоты: расписание проверяют один раз, при настройке, и
 * ждать до девяти утра, чтобы увидеть опечатку в наборе блоков, глупо.
 */
export async function sendReportNowAction(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Не указано расписание.' };

  // Проверяем принадлежность расписания компании под RLS, а отправляем уже
  // серверным клиентом: у планировщика нет пользовательской сессии.
  const supabase = await createServerSupabase();
  const { data } = await supabase.from('report_schedules').select('id').eq('id', id).maybeSingle();
  if (!data) return { error: 'Расписание не найдено.' };

  const ok = await sendReportNow(id);
  if (!ok) return { error: 'Не удалось отправить отчёт.' };

  return { success: 'Отчёт отправлен в группу.' };
}

/** Отвязать группу: заодно уходят и все её расписания. */
export async function removeReportChat(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Не указана группа.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('report_chats').delete().eq('id', id);

  if (error) return { error: 'Не удалось отвязать группу.' };

  revalidatePath('/dashboard/settings');
  return { success: 'Группа отвязана.' };
}
