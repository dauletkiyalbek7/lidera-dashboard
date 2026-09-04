import { leadStatusFor, type LeadStatus } from '@/lib/lead-status';
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
  /**
   * Что с уроком: «Думает · Айгерим».
   *
   * Отдельной строкой от статуса намеренно. «Думает» и «Отказ» есть и у
   * менеджера, и у продажника, но означают разное — до урока и после. В одной
   * строке они слились бы, и стало бы не понять, кто и на каком шаге решил.
   */
  trialNote?: string | null;
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
    lead.trialNote ? `🎓 Урок: ${escapeHtml(lead.trialNote)}` : null,
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
export const STATUS_ICON: Record<LeadStatus, string> = {
  new: '🆕',
  no_answer: '📵',
  thinking: '🤔',
  trial: '🎓',
  sale: '💰',
  rejected: '🚫',
};

/**
 * «Написать в WhatsApp» — ряд под карточкой.
 *
 * Половина клиентов не берёт трубку с незнакомого номера, но отвечает в
 * переписке. Без кнопки менеджер копировал номер руками и искал его в
 * WhatsApp — на двадцати заявках это уже отдельная работа.
 *
 * Ссылка wa.me открывает чат с человеком, даже если его нет в контактах.
 * Номер идёт одними цифрами: скобки и дефисы она не понимает.
 */
export function whatsappButton(phone: string | null | undefined): InlineButton[][] {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return [];
  return [[{ text: '💬 Написать в WhatsApp', url: `https://wa.me/${digits}` }]];
}

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
 * Запись на онлайн-урок в два шага: день → час. Продажника выбирает
 * система — менеджеру важно вернуться к клиенту с ответом, а не изучать
 * список людей, которых он в лицо не знает.
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

/**
 * Часы урока: рабочее окно отдела, ровные часы.
 *
 * Получасовых делений здесь нет намеренно. Урок длится час, поэтому запись на
 * 13:00 всё равно перекрывала 12:30 и 13:30 — половина сетки состояла из
 * клеток, которые нажать нельзя. Ровный час говорит менеджеру правду: что
 * видно, то и свободно.
 *
 * Пока список общий на всю платформу. Когда понадобится учитывать обед и то,
 * что смена у одних начинается в девять, а у других заканчивается в девять
 * вечера, окно переедет в настройки компании — сетка тогда будет строиться
 * из них, а не из этой константы.
 */
export const BOOKING_HOURS = [
  '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00',
  '17:00', '18:00', '19:00', '20:00',
];

/**
 * Часы урока: занятые видны, но не нажимаются.
 *
 * Пропуск в сетке менеджер читает как «такого времени у нас нет», а замок —
 * как «это уже занято, давайте соседнее». Вторая новость честнее: клиент
 * слышит от менеджера «в час занято, давайте в два», а не растерянное молчание.
 */
export function bookingTimeButtons(
  trialId: string,
  slots: { time: string; free: boolean }[],
): InlineButton[][] {
  const buttons = slots.map((slot) =>
    slot.free
      ? { text: slot.time, callback_data: `bt:${trialId}:${slot.time.replace(':', '')}` }
      : { text: `🔒 ${slot.time}`, callback_data: `bx:${slot.time}` },
  );

  const rows: InlineButton[][] = [];
  for (let index = 0; index < buttons.length; index += 4) {
    rows.push(buttons.slice(index, index + 4));
  }
  return rows;
}
