import { LEAD_STATUS, leadStatusesFor, type LeadStatus } from '@/lib/lead-status';
import { TOUCH_PRESETS } from '@/lib/lead-touches';
import type { FunnelType } from '@/lib/metrics';
import type { InlineButton } from '@/lib/telegram';

/**
 * Карточка лида для чата: одна форма и у списка «Мои лиды», и у сообщения
 * об авто-раздаче, и у напоминания — менеджер не должен разбираться в трёх
 * разных форматах.
 */

export type LeadCardData = {
  name: string;
  phone: string | null;
  source: string | null;
  platform: string | null;
  status: string;
  /** Объявление, с которого пришёл лид, — с ним понятно, о чём говорить. */
  creativeLabel?: string | null;
  touchCount?: number | null;
};

export function leadCard(lead: LeadCardData, title?: string): string {
  const rows = [
    title,
    `<b>${escapeHtml(lead.name || 'Без имени')}</b>`,
    // Номер отдельной строкой и без разметки: так Telegram сам делает его
    // ссылкой на звонок, а не куском текста.
    lead.phone ? `📞 ${escapeHtml(lead.phone)}` : null,
    lead.creativeLabel ? `🎬 ${escapeHtml(lead.creativeLabel)}` : null,
    lead.platform || lead.source
      ? `Источник: ${escapeHtml(sourceLabel(lead))}`
      : null,
    `Статус: ${LEAD_STATUS[lead.status as LeadStatus]?.label ?? lead.status}`,
    lead.touchCount ? `Попыток дозвона: ${lead.touchCount}` : null,
  ];
  return rows.filter(Boolean).join('\n');
}

function sourceLabel(lead: LeadCardData): string {
  const source = lead.platform ?? lead.source ?? '';
  if (source === 'meta') return 'Meta';
  if (source === 'tiktok') return 'TikTok';
  if (source === 'site') return 'Сайт';
  if (source === 'whatsapp') return 'WhatsApp';
  return source;
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

/** Кнопка «скопировать номер» — на телефоне это быстрее выделения пальцем. */
export function copyPhoneButton(phone: string | null): InlineButton[][] {
  if (!phone) return [];
  return [[{ text: '📋 Скопировать номер', copy_text: { text: phone } }]];
}

/**
 * Сроки следующего звонка. Показываются после «не дозвонился»: менеджер
 * выбирает, когда вернётся к лиду, и в это время бот напомнит.
 */
export function touchButtons(leadId: string): InlineButton[][] {
  const buttons = TOUCH_PRESETS.map((preset) => ({
    text: preset.short,
    callback_data: `t:${leadId}:${preset.key}`,
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
