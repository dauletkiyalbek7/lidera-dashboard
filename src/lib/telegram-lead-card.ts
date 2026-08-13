import { LEAD_STATUS, leadStatusesFor, type LeadStatus } from '@/lib/lead-status';
import type { FunnelType } from '@/lib/metrics';
import type { InlineButton } from '@/lib/telegram';

/**
 * Карточка лида для чата: одна форма и у списка «Мои лиды», и у сообщения
 * об авто-раздаче — менеджер не должен разбираться в двух разных форматах.
 */

export type LeadCardData = {
  name: string;
  phone: string | null;
  source: string | null;
  platform: string | null;
  status: string;
};

export function leadCard(lead: LeadCardData, title?: string): string {
  const rows = [
    title,
    `<b>${escapeHtml(lead.name || 'Без имени')}</b>`,
    lead.phone ? `📞 ${escapeHtml(lead.phone)}` : null,
    lead.platform || lead.source
      ? `Источник: ${escapeHtml(lead.platform ?? lead.source ?? '')}`
      : null,
    `Статус: ${LEAD_STATUS[lead.status as LeadStatus]?.label ?? lead.status}`,
  ];
  return rows.filter(Boolean).join('\n');
}

/** Кнопки статусов. «Новый» не предлагаем — назад по воронке лид не двигают. */
export function statusButtons(leadId: string, funnelType: FunnelType): InlineButton[][] {
  const buttons = leadStatusesFor(funnelType)
    .filter((status) => status !== 'new')
    .map((status) => ({
      text: LEAD_STATUS[status].label,
      callback_data: `s:${leadId}:${status}`,
    }));

  const rows: InlineButton[][] = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  return rows;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
