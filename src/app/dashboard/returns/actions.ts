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
  const { readOnly, employee } = await requireCompanySession();
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

  // Журнал и статус продажи меняются одной функцией базы: раньше это были два
  // запроса подряд, и падение второго оставляло возвращённые деньги в выручке.
  // Она же проверяет право — у РОПа профиль без права записи, и обычный запрос
  // база бы отклонила.
  const { error } = await supabase.rpc('register_return', {
    sale: parsed.data.saleId,
    refund: parsed.data.amount,
    reason: parsed.data.reason ?? null,
  });

  if (error) {
    // Свои сообщения функция пишет по-русски — их и показываем. Уникальный
    // ключ по продаже (23505) значит гонку: возврат успели оформить рядом.
    const known =
      error.code === '23505'
        ? 'По этой продаже возврат уже оформлен.'
        : /[а-яё]/i.test(error.message)
          ? error.message
          : null;

    return { error: known ?? 'Не удалось оформить возврат.' };
  }

  revalidatePath('/dashboard', 'layout');
  return { success: 'Возврат оформлен. Продажа больше не в выручке.' };
}
