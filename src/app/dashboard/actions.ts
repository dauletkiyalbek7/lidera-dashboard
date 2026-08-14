'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { zonedIsoDate } from '@/lib/period';
import { sendPurchaseForSale } from '@/lib/capi';
import { runDistribution } from '@/lib/lead-distribution';
import { LEAD_STATUS_ORDER, type LeadStatus } from '@/lib/lead-status';
import { isTouchPreset, resolveTouchTime, TOUCH_PRESETS } from '@/lib/lead-touches';
import { closeOpenTouches, scheduleTouch } from '@/lib/touch-runner';
import { createAdminSupabase } from '@/lib/supabase/admin';
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

const LEAD_STATUSES = LEAD_STATUS_ORDER;
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
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = leadSchema.safeParse({
    name: formData.get('name'),
    phone: formData.get('phone'),
    source: formData.get('source'),
    platform: emptyToUndefined(formData.get('platform')),
    creativeId: formData.get('creativeId') ?? '',
    status: formData.get('status'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!allowsStatus(company.funnel_type, parsed.data.status)) {
    return { error: 'В вашей компании продажа идёт без пробных занятий.' };
  }

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

  // Лид, заведённый руками, попадает в ту же очередь, что и рекламный:
  // если кто-то на смене, он уйдёт менеджеру сразу.
  await runDistribution(company.id);

  revalidateCabinet();
  return { success: 'Лид добавлен.' };
}

export async function updateLeadStatus(
  leadId: string,
  status: string,
): Promise<CrmState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = z
    .object({ leadId: z.string().uuid(), status: z.enum(LEAD_STATUSES) })
    .safeParse({ leadId, status });

  if (!parsed.success) return { error: 'Некорректный статус.' };
  if (!allowsStatus(company.funnel_type, parsed.data.status)) {
    return { error: 'В вашей компании продажа идёт без пробных занятий.' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('leads')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.leadId)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось изменить статус.' };

  // Статус лида и разделы воронки должны совпадать: иначе менеджер отмечает
  // «пробный», а в разделе «Пробные» пусто, и записи приходится дублировать.
  if (parsed.data.status === 'trial' || parsed.data.status === 'sale') {
    const { data: existing } = await supabase
      .from('trials')
      .select('id, status')
      .eq('company_id', company.id)
      .eq('lead_id', parsed.data.leadId)
      .maybeSingle();

    if (!existing && parsed.data.status === 'trial') {
      await supabase.from('trials').insert({
        company_id: company.id,
        lead_id: parsed.data.leadId,
        date: zonedIsoDate(new Date(), company.timezone),
        status: 'scheduled',
      });
    }

    // Купил — значит пробное состоялось: до продажи иначе не доходят.
    if (parsed.data.status === 'sale' && existing && existing.status !== 'completed') {
      await supabase.from('trials').update({ status: 'completed' }).eq('id', existing.id);
    }
  }

  // Лид сдвинулся — обещание перезвонить закрываем, иначе бот напомнит про
  // клиента, с которым уже поговорили.
  if (parsed.data.status !== 'no_answer') {
    await closeOpenTouches(createAdminSupabase(), parsed.data.leadId);
  }

  revalidateCabinet();
  return { success: 'Статус обновлён.' };
}

/**
 * Обещание перезвонить, поставленное из кабинета.
 *
 * То же самое, что кнопка в боте: лид остаётся за своим менеджером, а срок
 * следующего звонка фиксируется, чтобы бот напомнил и чтобы просрочку было
 * видно РОПу.
 */
export async function planCallback(leadId: string, preset: string): Promise<CrmState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };
  if (!isTouchPreset(preset)) return { error: 'Неизвестный срок.' };

  const parsed = z.string().uuid().safeParse(leadId);
  if (!parsed.success) return { error: 'Некорректный лид.' };

  const supabase = await createServerSupabase();
  const { data: lead } = await supabase
    .from('leads')
    .select('id, assigned_to')
    .eq('id', parsed.data)
    .eq('company_id', company.id)
    .maybeSingle();

  if (!lead) return { error: 'Лид не найден.' };

  const remindAt = resolveTouchTime(preset, company.timezone);

  await scheduleTouch(createAdminSupabase(), {
    companyId: company.id,
    leadId: lead.id,
    employeeId: lead.assigned_to,
    remindAt,
    countsAsAttempt: true,
  });

  revalidateCabinet();

  const label = TOUCH_PRESETS.find((item) => item.key === preset)?.label ?? '';
  return { success: `Перезвонить: ${label.toLowerCase()}.` };
}

/**
 * «Раздать сейчас» — для ночной очереди.
 *
 * Ночью смен нет, и заявки копятся нераспределёнными. Утром РОП или директор
 * нажимает кнопку, и всё накопившееся расходится поровну между теми, кто уже
 * на смене.
 */
export async function distributeNow(): Promise<CrmState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const result = await runDistribution(company.id);
  revalidateCabinet();

  if (result.assigned === 0 && result.queued > 0) {
    return {
      error: 'Раздавать некому: никто не на смене или у всех заполнен лимит заявок.',
    };
  }

  if (result.assigned === 0) return { success: 'Нераспределённых заявок нет.' };

  return {
    success: `Разошлось заявок: ${result.assigned}${
      result.queued > 0 ? `, осталось в очереди: ${result.queued}` : ''
    }.`,
  };
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
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

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

  const { data: sale, error } = await supabase
    .from('sales')
    .insert({
      company_id: company.id,
      lead_id: leadId,
      product: parsed.data.product,
      amount: parsed.data.amount,
      sale_date: parsed.data.saleDate,
      status: parsed.data.status,
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: 'Не удалось сохранить продажу.' };

  if (leadId && parsed.data.status === 'paid') {
    await supabase
      .from('leads')
      .update({ status: 'sale' })
      .eq('id', leadId)
      .eq('company_id', company.id);
  }

  if (sale && parsed.data.status === 'paid') await reportPurchase(company.id, sale.id);

  revalidateCabinet();
  return { success: 'Продажа записана.' };
}

export async function updateSaleStatus(saleId: string, status: string): Promise<CrmState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

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

  // Оплату сообщаем рекламной площадке: именно на покупателях она учится.
  if (parsed.data.status === 'paid') await reportPurchase(company.id, parsed.data.saleId);

  revalidateCabinet();
  return { success: 'Статус обновлён.' };
}

/**
 * Сообщить рекламной площадке об оплате.
 *
 * Отправка не должна мешать работе: если CAPI не настроен или Meta ответила
 * отказом, продажа всё равно записана, а причина сохранена в журнале событий.
 */
async function reportPurchase(companyId: string, saleId: string): Promise<void> {
  try {
    await sendPurchaseForSale(companyId, saleId);
  } catch {
    // Молча: подробности уже легли в capi_events, а директор ждёт ответа формы.
  }
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
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

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
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

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

/**
 * Шаг «пробный» существует не у всех: товарному бизнесу его нельзя выставить
 * даже подделанным запросом, поэтому проверка стоит на сервере, а не в форме.
 */
function allowsStatus(funnelType: string, status: LeadStatus): boolean {
  return status !== 'trial' || funnelType === 'trial';
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? undefined : text;
}
