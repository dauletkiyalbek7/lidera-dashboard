'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Ручная работа с CRM: завести лид, сдвинуть его по воронке, оформить продажу
 * или записать на пробное.
 *
 * company_id всегда берётся из сессии, а не из формы — идентификатор компании
 * не должен приходить из браузера. Вторым рубежом стоит RLS: запись с чужим
 * company_id отклонит сама база.
 */

export type CrmState = { error?: string; success?: string };

const LEAD_STATUSES = ['new', 'in_progress', 'qualified', 'trial', 'sale', 'rejected'] as const;
const TRIAL_STATUSES = ['scheduled', 'completed', 'no_show', 'canceled'] as const;
const SALE_STATUSES = ['pending', 'paid', 'refunded', 'canceled'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

const leadSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя лида').max(120),
  phone: optionalText(40),
  source: optionalText(40),
  platform: z.enum(['meta', 'tiktok', 'google', 'other']).optional(),
  creativeId: z.string().uuid().optional().or(z.literal('')),
  status: z.enum(LEAD_STATUSES),
});

export async function createLead(
  _prevState: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const { company } = await requireCompanySession();

  const parsed = leadSchema.safeParse({
    name: formData.get('name'),
    phone: formData.get('phone'),
    source: formData.get('source'),
    platform: emptyToUndefined(formData.get('platform')),
    creativeId: formData.get('creativeId') ?? '',
    status: formData.get('status'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('leads').insert({
    company_id: company.id,
    name: parsed.data.name,
    phone: parsed.data.phone,
    source: parsed.data.source ?? 'manual',
    platform: parsed.data.platform ?? null,
    creative_id: parsed.data.creativeId || null,
    status: parsed.data.status,
  });

  if (error) return { error: 'Не удалось сохранить лид.' };

  revalidateCabinet();
  return { success: 'Лид добавлен.' };
}

export async function updateLeadStatus(
  leadId: string,
  status: string,
): Promise<CrmState> {
  const { company } = await requireCompanySession();

  const parsed = z
    .object({ leadId: z.string().uuid(), status: z.enum(LEAD_STATUSES) })
    .safeParse({ leadId, status });

  if (!parsed.success) return { error: 'Некорректный статус.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('leads')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.leadId)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось изменить статус.' };

  revalidateCabinet();
  return { success: 'Статус обновлён.' };
}

const saleSchema = z.object({
  leadId: z.string().uuid().optional().or(z.literal('')),
  product: optionalText(120),
  amount: z.coerce.number().min(0, 'Сумма не может быть отрицательной').max(1_000_000_000),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату продажи'),
  status: z.enum(SALE_STATUSES),
});

/**
 * Продажа — конец цепочки. Если она привязана к лиду, лид сразу переводится
 * в статус «продажа»: иначе воронка и таблица креативов разойдутся с фактом.
 */
export async function registerSale(
  _prevState: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const { company } = await requireCompanySession();

  const parsed = saleSchema.safeParse({
    leadId: formData.get('leadId') ?? '',
    product: formData.get('product'),
    amount: formData.get('amount'),
    saleDate: formData.get('saleDate'),
    status: formData.get('status'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const leadId = parsed.data.leadId || null;

  const { error } = await supabase.from('sales').insert({
    company_id: company.id,
    lead_id: leadId,
    product: parsed.data.product,
    amount: parsed.data.amount,
    sale_date: parsed.data.saleDate,
    status: parsed.data.status,
  });

  if (error) return { error: 'Не удалось сохранить продажу.' };

  if (leadId && parsed.data.status === 'paid') {
    await supabase
      .from('leads')
      .update({ status: 'sale' })
      .eq('id', leadId)
      .eq('company_id', company.id);
  }

  revalidateCabinet();
  return { success: 'Продажа записана.' };
}

export async function updateSaleStatus(saleId: string, status: string): Promise<CrmState> {
  const { company } = await requireCompanySession();

  const parsed = z
    .object({ saleId: z.string().uuid(), status: z.enum(SALE_STATUSES) })
    .safeParse({ saleId, status });

  if (!parsed.success) return { error: 'Некорректный статус.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('sales')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.saleId)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось изменить статус.' };

  revalidateCabinet();
  return { success: 'Статус обновлён.' };
}

const trialSchema = z.object({
  leadId: z.string().uuid('Выберите лид'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату'),
  status: z.enum(TRIAL_STATUSES),
});

export async function registerTrial(
  _prevState: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const { company } = await requireCompanySession();

  if (company.funnel_type !== 'trial') {
    return { error: 'В вашей компании продажа идёт без пробных занятий.' };
  }

  const parsed = trialSchema.safeParse({
    leadId: formData.get('leadId'),
    date: formData.get('date'),
    status: formData.get('status'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('trials').insert({
    company_id: company.id,
    lead_id: parsed.data.leadId,
    date: parsed.data.date,
    status: parsed.data.status,
  });

  if (error) return { error: 'Не удалось записать пробное.' };

  // Лид переходит на шаг «пробный», если он ещё не дошёл до продажи.
  await supabase
    .from('leads')
    .update({ status: 'trial' })
    .eq('id', parsed.data.leadId)
    .eq('company_id', company.id)
    .neq('status', 'sale');

  revalidateCabinet();
  return { success: 'Пробное записано.' };
}

export async function updateTrialStatus(
  trialId: string,
  status: string,
): Promise<CrmState> {
  const { company } = await requireCompanySession();

  const parsed = z
    .object({ trialId: z.string().uuid(), status: z.enum(TRIAL_STATUSES) })
    .safeParse({ trialId, status });

  if (!parsed.success) return { error: 'Некорректный статус.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('trials')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.trialId)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось изменить статус.' };

  revalidateCabinet();
  return { success: 'Статус обновлён.' };
}

/** Цифры на дашборде зависят от этих записей, поэтому обновляем весь кабинет. */
function revalidateCabinet() {
  revalidatePath('/dashboard', 'layout');
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? undefined : text;
}
