'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { runDistribution } from '@/lib/lead-distribution';
import { LEAD_QUALITY_ORDER } from '@/lib/lead-quality';
import { LEAD_STATUS_ORDER, type LeadStatus } from '@/lib/lead-status';
import { instantInZone } from '@/lib/lead-touches';
import { TRIAL_STATUS_ORDER, leadStatusAfterTrial } from '@/lib/trial-status';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  formatTrialTime,
  notifyTrialBooked,
  sellerAvailability,
  syncTrialForLead,
} from '@/lib/trials';

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
const TRIAL_STATUSES = TRIAL_STATUS_ORDER;
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
  // «Пробный» сразу уходит продажнику — на нём цепочка не должна обрываться.
  if (parsed.data.status === 'trial' || parsed.data.status === 'sale') {
    await syncTrialForLead(createAdminSupabase(), {
      companyId: company.id,
      leadId: parsed.data.leadId,
      status: parsed.data.status,
      timezone: company.timezone,
    });
    await runDistribution(company.id);
  }

  revalidateCabinet();
  return { success: 'Статус обновлён.' };
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
  // Оценка нужна рекламе, а не отчёту: на случайном покупателе Meta учиться не
  // должна. В боте её спрашивают сразу после суммы — на платформе теперь тоже.
  quality: z.enum(LEAD_QUALITY_ORDER).optional(),
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
    quality: emptyToUndefined(formData.get('quality')),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const leadId = parsed.data.leadId || null;

  // Продавца записываем в саму продажу — того, за кем клиент числится сейчас.
  // Дальше он не меняется: передадут заявку другому или удалят карточку, а
  // выручка останется за тем, кто её сделал.
  const seller = leadId ? await sellerOfLead(supabase, company.id, leadId) : null;

  const { error } = await supabase
    .from('sales')
    .insert({
      company_id: company.id,
      lead_id: leadId,
      product: parsed.data.product,
      amount: parsed.data.amount,
      sale_date: parsed.data.saleDate,
      status: parsed.data.status,
      seller_id: seller?.id ?? null,
      seller_name: seller?.name ?? null,
    })
    .select('id')
    .maybeSingle();

  // 23505 — уникальный индекс «одна оплаченная продажа на лид». Значит чек по
  // этому клиенту уже провели: чаще всего продажник отметил его в боте.
  if (error) {
    return {
      error:
        error.code === '23505'
          ? 'По этому клиенту продажа уже проведена — вторая удвоила бы выручку.'
          : 'Не удалось сохранить продажу.',
    };
  }

  if (leadId && parsed.data.status === 'paid') {
    await supabase
      .from('leads')
      .update({
        status: 'sale',
        ...(parsed.data.quality ? { quality: parsed.data.quality } : {}),
      })
      .eq('id', leadId)
      .eq('company_id', company.id);
  }


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

  revalidateCabinet();
  return { success: 'Статус обновлён.' };
}


const trialSchema = z.object({
  leadId: z.string().uuid('Выберите лид'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Укажите время урока'),
  sellerId: z.string().uuid('Выберите продажника'),
  amount: z.coerce.number().min(0).max(1_000_000_000).optional(),
});

/**
 * Запись на онлайн-урок.
 *
 * Время менеджер согласовывает с клиентом и назначает продажника, который в
 * этот час свободен — очередь тут ничего не решает. Урок идёт по видеосвязи,
 * поэтому час важен не меньше даты.
 */
export async function registerTrial(
  _prevState: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  if (company.funnel_type !== 'trial') {
    return { error: 'В вашей компании продажа идёт без пробных уроков.' };
  }

  const parsed = trialSchema.safeParse({
    leadId: formData.get('leadId'),
    date: formData.get('date'),
    time: formData.get('time'),
    sellerId: formData.get('sellerId'),
    amount: formData.get('amount') || 0,
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const startsAt = instantInZone(parsed.data.date, parsed.data.time, company.timezone);
  if (!startsAt) return { error: 'Не удалось разобрать дату и время урока.' };

  const admin = createAdminSupabase();

  // Занятость проверяем на сервере: между открытием формы и отправкой этот
  // час мог занять другой менеджер.
  const availability = await sellerAvailability(admin, company.id, startsAt);
  const seller = availability.find((item) => item.id === parsed.data.sellerId);

  if (!seller) return { error: 'Такого продажника нет в компании.' };
  if (seller.busy) {
    return { error: `${seller.fullName} уже ведёт урок в это время. Выберите другого или другой час.` };
  }

  const supabase = await createServerSupabase();

  // Черновик, созданный статусом «Пробный», дополняем, а не плодим второй.
  const { data: draft } = await supabase
    .from('trials')
    .select('id')
    .eq('company_id', company.id)
    .eq('lead_id', parsed.data.leadId)
    .is('starts_at', null)
    .maybeSingle();

  const payload = {
    company_id: company.id,
    lead_id: parsed.data.leadId,
    date: parsed.data.date,
    starts_at: startsAt.toISOString(),
    assigned_to: parsed.data.sellerId,
    assigned_at: new Date().toISOString(),
    status: 'scheduled' as const,
    amount: parsed.data.amount ?? 0,
    reminded_at: null,
  };

  const { error } = draft
    ? await supabase.from('trials').update(payload).eq('id', draft.id)
    : await supabase.from('trials').insert(payload);

  if (error) return { error: 'Не удалось записать урок.' };

  // Лид переходит на шаг «пробный», если он ещё не дошёл до продажи.
  await supabase
    .from('leads')
    .update({ status: 'trial' })
    .eq('id', parsed.data.leadId)
    .eq('company_id', company.id)
    .neq('status', 'sale');

  await notifyTrialBooked(admin, company.id, parsed.data.leadId, startsAt, parsed.data.sellerId, company.timezone);

  revalidateCabinet();
  return { success: `Урок записан на ${formatTrialTime(startsAt, company.timezone)}.` };
}

/** Свободен ли продажник в этот час — для формы записи. */
export async function checkAvailability(
  date: string,
  time: string,
): Promise<{ sellers: { id: string; fullName: string; busy: boolean }[]; error?: string }> {
  const { company } = await requireCompanySession();

  const startsAt = instantInZone(date, time, company.timezone);
  if (!startsAt) return { sellers: [], error: 'Проверьте дату и время.' };

  const list = await sellerAvailability(createAdminSupabase(), company.id, startsAt);
  return { sellers: list.map(({ id, fullName, busy }) => ({ id, fullName, busy })) };
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
  const { data: trial, error } = await supabase
    .from('trials')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.trialId)
    .eq('company_id', company.id)
    .select('lead_id')
    .maybeSingle();

  if (error) return { error: 'Не удалось изменить статус.' };

  // Исход урока — это и про лид: выручка, воронка и событие в Meta считаются
  // по нему, а не по уроку. Раньше отметка оставалась только на уроке, и в
  // разделе «Лиды» человек так и висел записанным на занятие, которое прошло.
  // Правило перехода одно на кабинет и на бота — иначе они разойдутся.
  const nextLeadStatus = leadStatusAfterTrial(parsed.data.status);

  if (nextLeadStatus && trial?.lead_id) {
    await supabase
      .from('leads')
      .update({ status: nextLeadStatus })
      .eq('id', trial.lead_id)
      .eq('company_id', company.id);
  }

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

/**
 * Кто ведёт этого клиента — на момент продажи.
 *
 * Спрашиваем один раз и кладём в продажу снимком: связь «продажа → клиент →
 * сотрудник» живёт ровно до первой передачи заявки, а отчёт по выручке
 * человека обязан пережить и передачу, и увольнение.
 */
async function sellerOfLead(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  leadId: string,
): Promise<{ id: string; name: string } | null> {
  const { data: lead } = await supabase
    .from('leads')
    .select('assigned_to')
    .eq('company_id', companyId)
    .eq('id', leadId)
    .maybeSingle();

  if (!lead?.assigned_to) return null;

  const { data: employee } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('company_id', companyId)
    .eq('id', lead.assigned_to)
    .maybeSingle();

  return employee ? { id: employee.id, name: employee.full_name } : null;
}
