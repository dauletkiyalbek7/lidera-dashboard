import { leadStatusFor, type LeadStatus } from '@/lib/lead-status';
import { touchPreset, type TouchPresetKey } from '@/lib/lead-touches';
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

export function leadCard(lead: LeadCardData, title?: string, trialTerm?: string): string {
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
    `Статус: ${leadStatusFor(lead.status, trialTerm).label}`,
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
 * Кнопки менеджера — четыре исхода разговора и ничего лишнего.
 *
 * «Дозвон» убран намеренно: он отвечал на вопрос «состоялся ли разговор», а
 * менеджеру после звонка надо отметить, чем разговор кончился. Каждый из
 * четырёх исходов ведёт дальше сам — игнор и «думает» спрашивают, когда
 * вернуться, а покупка спрашивает сумму.
 *
 * Набор зависит от воронки. Там, где есть пробное занятие, продажу закрывает
 * продажник после урока, поэтому у менеджера вместо «Купил» стоит запись на
 * урок. В прямой воронке урока нет и продаёт он сам.
 */
export function statusButtons(
  leadId: string,
  funnelType: FunnelType,
  trialTerm?: string,
): InlineButton[][] {
  const buttons = MANAGER_STATUSES[funnelType].map((status) => ({
    text: `${STATUS_ICON[status]} ${leadStatusFor(status, trialTerm).label}`,
    callback_data: `s:${leadId}:${status}`,
  }));

  const rows: InlineButton[][] = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  return rows;
}

const MANAGER_STATUSES: Record<FunnelType, LeadStatus[]> = {
  direct: ['no_answer', 'thinking', 'rejected', 'sale'],
  trial: ['no_answer', 'thinking', 'trial', 'rejected'],
};

/**
 * Значки статусов. Живут здесь, а не в справочнике статусов: в таблицах
 * кабинета значков нет, там роль подписи играет цвет.
 */
const STATUS_ICON: Record<LeadStatus, string> = {
  new: '🆕',
  no_answer: '📵',
  contacted: '📞',
  in_progress: '⏳',
  thinking: '🤔',
  trial: '🎓',
  sale: '💰',
  rejected: '🚫',
};

/**
 * Когда вернуться к клиенту.
 *
 * Спрашивается сразу после «Игнора» и «Думает»: обещание, записанное в
 * момент разговора, — единственное, которое выполняется. Сроки разные:
 * не дозвонился — перезванивают в тот же день, взял паузу на решение —
 * через день-два.
 */
export function touchButtons(
  leadId: string,
  keys: TouchPresetKey[],
  skipText: string,
): InlineButton[][] {
  const buttons = keys.map((key) => ({
    text: touchPreset(key).short,
    callback_data: `t:${leadId}:${key}`,
  }));

  const rows: InlineButton[][] = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  rows.push([{ text: skipText, callback_data: `t:${leadId}:skip` }]);
  return rows;
}

/** Сроки после «Игнора»: клиент не взял трубку — пробуем ещё сегодня. */
export const NO_ANSWER_TOUCHES: TouchPresetKey[] = [
  'in_1h',
  'in_3h',
  'evening',
  'tomorrow',
];

/** Сроки после «Думает»: человеку дали время, дёргать его через час нельзя. */
export const THINKING_TOUCHES: TouchPresetKey[] = [
  'evening',
  'tomorrow',
  'in_2d',
  'in_week',
];

/**
 * Кнопки продажника под карточкой урока — шаг первый: состоялся ли урок.
 *
 * Решение клиента здесь намеренно не спрашивается. Между уроком и оплатой
 * обычно проходит день-два, и если свалить всё в один экран, продажник в
 * момент урока жмёт «Купил» авансом, а потом никто не помнит, было это на
 * самом деле или нет.
 */
export function trialButtons(trialId: string): InlineButton[][] {
  return [
    [{ text: '✅ Провёл урок', callback_data: `tr:${trialId}:completed` }],
    [
      { text: '📵 Не вышел на связь', callback_data: `tr:${trialId}:no_show` },
      { text: '🔄 Отменён', callback_data: `tr:${trialId}:canceled` },
    ],
  ];
}

/**
 * Шаг второй: чем кончилось решение клиента.
 *
 * «Банк не одобрил» стоит отдельно от «Отказа» намеренно. Курс берут в
 * рассрочку, и отказ банка — это не отказ человека: он хотел купить. В отчёте
 * продажника это разные вещи, и одной кнопкой их путать нельзя.
 */
export function trialOutcomeButtons(trialId: string): InlineButton[][] {
  return [
    [
      { text: '💰 Купил курс', callback_data: `tr:${trialId}:sale` },
      { text: '🤔 Думает', callback_data: `tr:${trialId}:thinking` },
    ],
    [
      { text: '🏦 Банк не одобрил', callback_data: `tr:${trialId}:bank_declined` },
      { text: '🚫 Отказ', callback_data: `tr:${trialId}:rejected` },
    ],
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
export function bookingDayButtons(trialId: string, timeZone: string): InlineButton[][] {
  const buttons = [0, 1, 2, 3].map((offset) => ({
    text: bookingDayLabel(offset, timeZone),
    callback_data: `bd:${trialId}:${offset}`,
  }));
  return [buttons.slice(0, 2), buttons.slice(2)];
}

/**
 * «Завтра, 5 сент.» — с датой, а не одним словом: менеджер согласовывает день
 * вслух с клиентом и должен видеть на кнопке ровно то число, которое называет.
 */
function bookingDayLabel(offset: number, timeZone: string): string {
  const day = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  const date = day.toLocaleDateString('ru-RU', { timeZone, day: 'numeric', month: 'short' });

  if (offset === 0) return `Сегодня, ${date}`;
  if (offset === 1) return `Завтра, ${date}`;

  const weekday = day.toLocaleDateString('ru-RU', { timeZone, weekday: 'short' });
  return `${weekday}, ${date}`;
}

/** Часы урока: рабочий день школы с шагом в полчаса. */
export const BOOKING_HOURS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
];

/**
 * Время урока.
 *
 * `after` отсекает часы, которые на выбранный день уже прошли: предложить
 * записать клиента на девять утра в четыре часа дня — верный способ получить
 * урок, о котором никто не напомнит.
 */
export function bookingTimeButtons(
  trialId: string,
  options?: { after?: string },
): InlineButton[][] {
  const after = options?.after;
  const slots = after ? BOOKING_HOURS.filter((time) => time > after) : BOOKING_HOURS;

  const buttons = slots.map((time) => ({
    text: time,
    callback_data: `bt:${trialId}:${time.replace(':', '')}`,
  }));

  const rows: InlineButton[][] = [];
  for (let index = 0; index < buttons.length; index += 4) {
    rows.push(buttons.slice(index, index + 4));
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
