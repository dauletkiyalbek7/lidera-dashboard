import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { zonedIsoDate } from '@/lib/period';
import type { Database } from '@/lib/supabase/database.types';

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

  // Купил — значит пробное состоялось: до продажи иначе не доходят.
  if (input.status === 'sale' && existing && existing.status !== 'completed') {
    await supabase.from('trials').update({ status: 'completed' }).eq('id', existing.id);
  }

  return { createdId: null };
}
