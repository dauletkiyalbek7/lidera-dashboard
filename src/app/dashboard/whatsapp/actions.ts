'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireFullAccess, VIEW_ONLY_ERROR } from '@/lib/auth';
import { encryptSecret } from '@/lib/secrets';
import { createServerSupabase } from '@/lib/supabase/server';

export type WhatsappState = { error?: string; success?: string };

/**
 * Значение поля формы.
 *
 * Отсутствующее поле FormData отдаёт как null, а не как undefined, и проверка
 * «строка или ничего» на нём спотыкается. Отсутствуют же они постоянно:
 * настройки автоответа рисуются только при включённом переключателе, и с
 * выключенным их в форме просто нет.
 */
function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Подключение номера WhatsApp.
 *
 * Токен и секрет приложения вводятся здесь и больше никогда не показываются:
 * при следующей правке поля пустые, а прежние значения остаются. В базу они
 * уходят зашифрованными, в браузер не возвращаются никогда.
 */
const numberSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, 'Назовите номер').max(60),
  displayPhone: z.string().trim().max(40, 'Слишком длинный номер').optional(),
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'Идентификатор номера — это число из Meta'),
  wabaId: z.string().trim().max(40, 'Слишком длинный идентификатор').optional(),
  datasetId: z
    .string()
    .trim()
    .regex(/^\d{10,25}$/, 'Набор данных — только цифры')
    .optional()
    .or(z.literal('')),
  departmentId: z.string().uuid().optional().or(z.literal('')),
  token: z.string().trim().optional(),
  appSecret: z.string().trim().optional(),
  autoReplyEnabled: z.boolean(),
  autoReplyDay: z.string().trim().max(1000, 'Текст ответа слишком длинный').optional(),
  autoReplyNight: z.string().trim().max(1000, 'Текст ответа слишком длинный').optional(),
  workStartTime: z.string().trim().optional(),
  workEndTime: z.string().trim().optional(),
});

export async function saveWhatsappNumber(
  _prevState: WhatsappState,
  formData: FormData,
): Promise<WhatsappState> {
  const { company, readOnly } = await requireFullAccess();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = numberSchema.safeParse({
    id: text(formData, 'id') || undefined,
    label: text(formData, 'label'),
    displayPhone: text(formData, 'displayPhone'),
    phoneNumberId: text(formData, 'phoneNumberId'),
    wabaId: text(formData, 'wabaId'),
    datasetId: text(formData, 'datasetId') ?? '',
    departmentId: text(formData, 'departmentId') ?? '',
    token: text(formData, 'token'),
    appSecret: text(formData, 'appSecret'),
    autoReplyEnabled: formData.get('autoReplyEnabled') === 'on',
    autoReplyDay: text(formData, 'autoReplyDay'),
    autoReplyNight: text(formData, 'autoReplyNight'),
    workStartTime: text(formData, 'workStartTime'),
    workEndTime: text(formData, 'workEndTime'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const input = parsed.data;
  const supabase = await createServerSupabase();

  // Выключенный автоответ не должен стирать заготовленные тексты: их писали
  // руками, а переключатель — это «пока не отвечать», а не «забыть».
  const keepAutoReply = !input.autoReplyEnabled;

  // Пустое поле означает «не менять»: иначе правка часов работы стирала бы
  // токен, и приём молча ломался бы после каждой мелкой настройки.
  const secrets: Record<string, string> = {};
  if (input.token) secrets.token_encrypted = encryptSecret(input.token);
  if (input.appSecret) secrets.app_secret_encrypted = encryptSecret(input.appSecret);

  const fields = {
    company_id: company.id,
    label: input.label,
    display_phone: input.displayPhone || null,
    phone_number_id: input.phoneNumberId,
    waba_id: input.wabaId || null,
    dataset_id: input.datasetId || null,
    department_id: input.departmentId || null,
    auto_reply_enabled: input.autoReplyEnabled,
    ...(keepAutoReply
      ? {}
      : {
          auto_reply_day: input.autoReplyDay || null,
          auto_reply_night: input.autoReplyNight || null,
          work_start_time: input.workStartTime || null,
          work_end_time: input.workEndTime || null,
        }),
    ...secrets,
  };

  const query = input.id
    ? supabase.from('whatsapp_numbers').update(fields).eq('id', input.id).eq('company_id', company.id)
    : supabase.from('whatsapp_numbers').insert(fields);

  const { error } = await query;

  if (error) {
    // Один и тот же номер нельзя завести дважды — ни в этой компании, ни в
    // соседней: события Meta различаются только по нему.
    if (error.code === '23505') {
      return { error: 'Такой номер уже подключён — проверьте идентификатор.' };
    }
    return { error: 'Не удалось сохранить номер.' };
  }

  revalidatePath('/dashboard/whatsapp');
  return { success: input.id ? 'Номер обновлён.' : 'Номер подключён.' };
}

/**
 * Отключение номера.
 *
 * Строку не удаляем: к ней привязаны переписки и лиды, и вместе с ней ушла бы
 * история обращений. Отключённый номер просто перестаёт принимать.
 */
export async function setNumberStatus(
  numberId: string,
  status: 'connected' | 'disconnected',
): Promise<WhatsappState> {
  const { company, readOnly } = await requireFullAccess();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('whatsapp_numbers')
    .update({ status })
    .eq('id', numberId)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось изменить состояние номера.' };

  revalidatePath('/dashboard/whatsapp');
  return { success: status === 'connected' ? 'Номер включён.' : 'Номер отключён.' };
}
