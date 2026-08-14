'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { sendPurchaseForSale } from '@/lib/capi';
import { encryptSecret } from '@/lib/secrets';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Настройка отправки покупок в Meta из кабинета компании.
 *
 * Токен приходит из формы, шифруется и ложится в таблицу без политик RLS —
 * пользовательским ключом её не прочитать вообще. Наружу он не возвращается
 * ни в каком виде: страница знает только, задан он или нет.
 */

export type CapiState = { error?: string; success?: string };

const settingsSchema = z.object({
  // Идентификатор набора данных Meta — длинное число.
  datasetId: z.string().trim().regex(/^\d{10,25}$/, 'Идентификатор набора — только цифры'),
  token: z.string().trim().min(20, 'Токен слишком короткий').optional().or(z.literal('')),
  testEventCode: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value : null)),
  enabled: z.coerce.boolean(),
});

export async function saveCapiSettings(
  _prev: CapiState,
  formData: FormData,
): Promise<CapiState> {
  const { company, readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = settingsSchema.safeParse({
    datasetId: formData.get('datasetId'),
    token: formData.get('token'),
    testEventCode: formData.get('testEventCode'),
    enabled: formData.get('enabled') === 'on',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Проверьте поля.' };
  }

  const supabase = createAdminSupabase();
  const { data: existing } = await supabase
    .from('capi_settings')
    .select('company_id, token_encrypted')
    .eq('company_id', company.id)
    .maybeSingle();

  // Пустое поле токена означает «оставить прежний» — иначе при каждой правке
  // настроек его пришлось бы вставлять заново.
  if (!parsed.data.token && !existing) {
    return { error: 'Для первой настройки нужен токен доступа.' };
  }

  const payload = {
    company_id: company.id,
    dataset_id: parsed.data.datasetId,
    token_encrypted: parsed.data.token
      ? encryptSecret(parsed.data.token)
      : (existing?.token_encrypted ?? ''),
    test_event_code: parsed.data.testEventCode,
    enabled: parsed.data.enabled,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('capi_settings')
    .upsert(payload, { onConflict: 'company_id' });

  if (error) return { error: 'Не удалось сохранить настройки.' };

  revalidatePath('/dashboard/capi');
  return { success: 'Настройки сохранены.' };
}

/**
 * Повторная отправка покупки: событие могло не уйти из-за истёкшего токена
 * или сбоя сети, и после починки его нужно дослать вручную.
 */
export async function resendPurchase(saleId: string): Promise<CapiState> {
  const { company, readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = z.string().uuid().safeParse(saleId);
  if (!parsed.success) return { error: 'Некорректная продажа.' };

  const result = await sendPurchaseForSale(company.id, parsed.data);
  revalidatePath('/dashboard/capi');

  return result.ok ? { success: 'Событие отправлено.' } : { error: result.error };
}
