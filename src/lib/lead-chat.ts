import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/database.types';
import { sendMessage } from '@/lib/telegram';
import { escapeHtml, leadCard, whatsappButton } from '@/lib/telegram-lead-card';

/**
 * Карточка в общую группу о клиенте, который написал не с рекламы.
 *
 * Рекламных клиентов видно в кабинете Meta и в отчётах, а тех, кто пришёл с
 * контента — из шапки профиля, сторис, канала, — не видно нигде, кроме списка
 * лидов. Группа делает этот поток заметным: каждая карточка называет источник,
 * и по ленте чата понятно, что из контента приводит людей.
 *
 * Кнопок статуса под карточкой нет намеренно: они привязаны к менеджеру,
 * которому заявка назначена, а в группе их нажал бы кто угодно.
 */

type Admin = SupabaseClient<Database>;

/** Длиннее этого первое сообщение в карточке обрезаем: чат не для чтения писем. */
const MESSAGE_PREVIEW = 300;

export type OrganicLead = {
  name: string;
  phone: string;
  /** Метка из готового сообщения: ig_stories, ig_bio… Пусто — написал сам. */
  utmSource: string | null;
  /** Первое сообщение клиента. */
  text: string | null;
};

/** Отправить карточку в группу проекта, если группа привязана. */
export async function announceOrganicLead(
  supabase: Admin,
  companyId: string,
  lead: OrganicLead,
): Promise<void> {
  const { data: company } = await supabase
    .from('companies')
    .select('lead_chat_id')
    .eq('id', companyId)
    .maybeSingle();

  if (!company?.lead_chat_id) return;

  const card = leadCard(
    {
      name: lead.name,
      phone: lead.phone,
      source: 'whatsapp',
      platform: null,
      utm_source: lead.utmSource,
      status: 'new',
    },
    '📥 <b>Новый клиент не с рекламы</b>',
  );

  const preview = lead.text?.trim().slice(0, MESSAGE_PREVIEW);
  const text = preview ? `${card}\n\n💬 ${escapeHtml(preview)}` : card;

  await sendMessage(company.lead_chat_id, text, { inline: whatsappButton(lead.phone) });
}
