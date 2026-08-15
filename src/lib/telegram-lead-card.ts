import { LEAD_STATUS, leadStatusesFor, type LeadStatus } from '@/lib/lead-status';
import type { FunnelType } from '@/lib/metrics';
import { LEAD_QUALITY, LEAD_QUALITY_ORDER } from '@/lib/lead-quality';
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

/**
 * Кнопки менеджера.
 *
 * «Купил» здесь нет намеренно: курс закрывает продажник на уроке, а менеджер
 * доводит до пробного. «Пробный» и означает, что клиент оплатил пробный урок.
 * «В работе» тоже убран — «Дозвон» уже говорит, что разговор состоялся.
 */
export function statusButtons(leadId: string, funnelType: FunnelType): InlineButton[][] {
  const buttons = leadStatusesFor(funnelType)
    .filter((status) => MANAGER_STATUSES.includes(status))
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

/**
 * Что менеджер отмечает после звонка. Порядок — от частого к редкому.
 * Телефон в карточке Telegram и так делает ссылкой на звонок.
 */
const MANAGER_STATUSES: LeadStatus[] = [
  'no_answer',
  'contacted',
  'thinking',
  'trial',
  'rejected',
];

/**
 * Кнопки продажника под карточкой пробного занятия.
 * Три исхода, которые он и отмечает по факту: провёл, не пришёл, купил.
 */
export function trialButtons(trialId: string): InlineButton[][] {
  return [
    [
      { text: '✅ Провёл', callback_data: `tr:${trialId}:completed` },
      { text: '📵 Не вышел на связь', callback_data: `tr:${trialId}:no_show` },
    ],
    [
      { text: '💰 Купил курс', callback_data: `tr:${trialId}:sale` },
      { text: '🚫 Не одобрил', callback_data: `tr:${trialId}:rejected` },
    ],
    [{ text: '🔄 Отменён', callback_data: `tr:${trialId}:canceled` }],
  ];
}

/**
 * Оценка клиента после продажи. Иконки крупные и однозначные: продажник
 * жмёт их на бегу, читать подписи ему некогда.
 */
export function qualityButtons(leadId: string | null): InlineButton[][] {
  if (!leadId) return [];
  return [
    LEAD_QUALITY_ORDER.map((quality) => ({
      text: `${LEAD_QUALITY[quality].icon} ${LEAD_QUALITY[quality].label}`,
      callback_data: `q:${leadId}:${quality}`,
    })),
  ];
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Запись на онлайн-урок в три шага: день → час → продажник.
 *
 * Всё кнопками, без ввода текста: менеджер держит телефон одной рукой и
 * говорит с клиентом, набирать дату ему нечем. Идентификатор урока короче
 * связки «лид + время», поэтому шаги ссылаются на него.
 */
export function bookingDayButtons(trialId: string): InlineButton[][] {
  return [
    [
      { text: 'Сегодня', callback_data: `bd:${trialId}:0` },
      { text: 'Завтра', callback_data: `bd:${trialId}:1` },
    ],
    [
      { text: 'Послезавтра', callback_data: `bd:${trialId}:2` },
      { text: 'Через 3 дня', callback_data: `bd:${trialId}:3` },
    ],
  ];
}

/** Часы урока: рабочий день школы с шагом в час. */
export const BOOKING_HOURS = [
  '09:00', '10:00', '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00', '19:00', '20:00',
];

export function bookingTimeButtons(trialId: string): InlineButton[][] {
  const buttons = BOOKING_HOURS.map((time) => ({
    text: time,
    callback_data: `bt:${trialId}:${time.replace(':', '')}`,
  }));

  const rows: InlineButton[][] = [];
  for (let index = 0; index < buttons.length; index += 3) {
    rows.push(buttons.slice(index, index + 3));
  }
  return rows;
}

/**
 * Продажники на выбор. В кнопку идёт место в списке, а не идентификатор:
 * два идентификатора в 64 байта callback_data не помещаются.
 */
export function bookingSellerButtons(
  trialId: string,
  sellers: { fullName: string; busy: boolean }[],
): InlineButton[][] {
  return sellers.map((seller, index) => [
    {
      text: seller.busy ? `${seller.fullName} — занят` : `✅ ${seller.fullName}`,
      callback_data: `bs:${trialId}:${index}`,
    },
  ]);
}
