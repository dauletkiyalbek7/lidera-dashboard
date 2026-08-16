'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type ReturnState = { error?: string; success?: string };

const VIEW_ONLY_ERROR = 'Режим наблюдения: изменения недоступны.';

const returnSchema = z.object({
  saleId: z.string().uuid(),
  amount: z.coerce
    .number()
    .min(0, 'Сумма не может быть отрицательной')
    .max(1_000_000_000, 'Проверьте сумму'),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Оформить возврат по продаже.
 *
 * Возврат — это две записи разом: строка в журнале возвратов и статус самой
 * продажи. Без первой мы не знаем, кто и почему вернул деньги; без второй
 * выручка так и осталась бы завышенной, потому что все отчёты считают по
 * оплаченным продажам.
 *
 * Оформляют РОП и директор. Менеджеру и продажнику это не по должности: они же
 * и продавали.
 */
export async function registerReturn(
  _prev: ReturnState,
  formData: FormData,
): Promise<ReturnState> {
  const { company, readOnly, employee } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  if (employee && employee.role !== 'rop') {
    return { error: 'Возврат оформляет РОП или директор.' };
  }

  const parsed = returnSchema.safeParse({
    saleId: formData.get('saleId'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();

  const { data: sale } = await supabase
    .from('sales')
    .select('id, amount, status')
    .eq('id', parsed.data.saleId)
    .eq('company_id', company.id)
    .maybeSingle();

  if (!sale) return { error: 'Продажа не найдена.' };
  if (sale.status === 'refunded') return { error: 'По этой продаже возврат уже оформлен.' };
  if (parsed.data.amount > Number(sale.amount)) {
    return { error: 'Возврат больше суммы продажи.' };
  }

  const { error } = await supabase.from('returns').insert({
    company_id: company.id,
    sale_id: sale.id,
    amount: parsed.data.amount,
    currency: company.sales_currency,
    reason: parsed.data.reason || null,
    processed_by: employee?.id ?? null,
  });

  // 23505 — уникальный ключ по продаже: возврат уже оформлен, просто гонка.
  if (error) {
    return {
      error:
        error.code === '23505'
          ? 'По этой продаже возврат уже оформлен.'
          : 'Не удалось оформить возврат.',
    };
  }

  // Статус меняем после записи журнала: если упадёт этот запрос, возврат
  // останется видимым в списке, и его можно будет доделать руками. Обратный
  // порядок потерял бы деньги из выручки без единого следа о причине.
  const { error: statusError } = await supabase
    .from('sales')
    .update({ status: 'refunded' })
    .eq('id', sale.id)
    .eq('company_id', company.id);

  if (statusError) {
    return { error: 'Возврат записан, но статус продажи изменить не удалось.' };
  }

  revalidatePath('/dashboard', 'layout');
  return { success: 'Возврат оформлен. Продажа больше не в выручке.' };
}
