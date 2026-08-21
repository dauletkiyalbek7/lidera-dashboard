'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { isWindowOpen } from '@/lib/inbox-queries';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { numberById, sendText } from '@/lib/whatsapp';

export type ReplyState = { error?: string; success?: string };

/** Больше в одно сообщение WhatsApp не берёт. */
const MAX_LENGTH = 4096;

const replySchema = z.object({
  leadId: z.string().uuid(),
  text: z
    .string()
    .trim()
    .min(1, 'Напишите сообщение')
    .max(MAX_LENGTH, 'Сообщение слишком длинное'),
});

/**
 * Ответ клиенту в WhatsApp.
 *
 * Отправка идёт сервисным ключом: токен номера лежит в таблице, закрытой от
 * пользовательских ключей, и расшифровать его может только сервер. Право
 * писать при этом проверяется здесь и явно — по компании и по тому, чей это
 * клиент.
 */
export async function sendReply(
  _prev: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const { company, readOnly, employee } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = replySchema.safeParse({
    leadId: formData.get('leadId'),
    text: formData.get('text'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = createAdminSupabase();

  const { data: lead } = await supabase
    .from('leads')
    .select('id, phone_digits, whatsapp_number_id, last_inbound_at, assigned_to')
    .eq('id', parsed.data.leadId)
    .eq('company_id', company.id)
    .maybeSingle();

  if (!lead) return { error: 'Клиент не найден.' };

  // Сотрудник пишет только своим: чужая переписка — не его работа.
  if (employee && lead.assigned_to !== employee.id) {
    return { error: 'Этот клиент закреплён не за вами.' };
  }

  if (!lead.whatsapp_number_id || !lead.phone_digits) {
    return { error: 'У клиента нет переписки в WhatsApp.' };
  }

  // Проверяем окно и здесь, а не только в интерфейсе: страница могла быть
  // открыта час назад, и за это время сутки успели истечь. Meta такое
  // сообщение отклонит, а менеджер будет уверен, что клиент его прочитал.
  if (!isWindowOpen(lead.last_inbound_at)) {
    return {
      error:
        'С последнего сообщения клиента прошло больше суток — Meta разрешает писать только утверждённым шаблоном.',
    };
  }

  const target = await numberById(supabase, company.id, lead.whatsapp_number_id);

  if (!target) return { error: 'Номер не найден.' };
  if (target.status !== 'connected') return { error: 'Номер отключён.' };
  if (!target.token) return { error: 'У номера не задан токен — писать нечем.' };

  await sendText(supabase, target, lead.id, lead.phone_digits, parsed.data.text);

  // Отправка сама пишет строку в переписку — и при успехе, и при отказе Meta.
  // Читаем её обратно: менеджер должен увидеть отказ сразу, а не решить, что
  // сообщение ушло.
  const { data: sent } = await supabase
    .from('whatsapp_messages')
    .select('status, error')
    .eq('lead_id', lead.id)
    .eq('direction', 'out')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  revalidatePath('/dashboard/inbox');

  if (sent?.status === 'failed') {
    return { error: sent.error ?? 'Meta отклонила сообщение.' };
  }

  return { success: 'Отправлено.' };
}
