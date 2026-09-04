import type { LeadStatus } from '@/lib/lead-status';

/**
 * Статусы онлайн-урока — единственное место, где описан его путь.
 *
 * Урок ведёт продажник, и отмечает он не то же самое, что менеджер. У
 * менеджера вопрос «дозвонился ли и что клиент ответил», у продажника —
 * «состоялся ли урок и чем кончилось решение». Поэтому наборы разные и живут
 * порознь: набор менеджера в lead-status.ts, набор продажника здесь.
 *
 * Решение отделено от самого урока намеренно: между уроком и оплатой обычно
 * проходит день-два, и продажнику нужно чем-то отметить, что урок уже провёл,
 * пока клиент думает.
 *
 * Отдельно стоит «Банк не одобрил». Курс берут в рассрочку, и отказ банка —
 * это не отказ клиента: человек хотел купить, а не дошло по чужой причине.
 * Считать это провалом продажника нельзя, поэтому у него свой статус, а не
 * общий «Отказ».
 *
 * Порядок массива — порядок движения; на нём строятся все списки.
 */

export const TRIAL_STATUS_ORDER = [
  'scheduled',
  'completed',
  'thinking',
  'sale',
  'bank_declined',
  'rejected',
  'no_show',
  'canceled',
] as const;

export type TrialStatus = (typeof TRIAL_STATUS_ORDER)[number];

export type TrialTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'lime';

/**
 * Крупная группа исходов — по ней строится отчёт руководителя отдела продаж.
 * «Банк отказал» вынесен из потерь: продажник свою работу сделал.
 */
export type TrialStage = 'planned' | 'deciding' | 'won' | 'blocked' | 'lost' | 'missed';

export const TRIAL_STAGE_LABELS: Record<TrialStage, string> = {
  planned: 'Назначены',
  deciding: 'Ждут решения',
  won: 'Купили курс',
  blocked: 'Банк отказал',
  lost: 'Отказались',
  missed: 'Не состоялись',
};

/** О чём бот спрашивает продажника сразу после отметки. */
export type TrialFollowUp = 'outcome' | 'return' | 'callback';

type TrialStatusMeta = {
  label: string;
  tone: TrialTone;
  hint: string;
  stage: TrialStage;
  /** Урок состоялся — считается в конверсии «дошли до урока». */
  held: boolean;
  /** Итог подведён: урок больше не в работе. */
  closed: boolean;
  /**
   * Во что переходит сам лид — почти всегда никуда.
   *
   * «Думает» и «Отказ» есть у обоих, но означают разное: у менеджера — до
   * урока, у продажника — после. Пока исход урока переписывал статус заявки,
   * эти пары сливались в одну, и в разделе «Лиды» было не понять, кто и на
   * каком шаге так решил. Теперь у каждого своё поле: статус заявки — работа
   * менеджера, статус урока — работа продажника, и рядом видно оба.
   *
   * Исключение одно — покупка. Она закрывает всю воронку, а не только урок:
   * по заявке считаются выручка и событие в рекламный кабинет.
   */
  leadStatus: LeadStatus | null;
  /** Следующий шаг продажника: без него отметка повисает без продолжения. */
  followUp: TrialFollowUp | null;
};

export const TRIAL_STATUS: Record<TrialStatus, TrialStatusMeta> = {
  scheduled: {
    label: 'Записан',
    tone: 'neutral',
    hint: 'Время согласовано, продажник назначен',
    stage: 'planned',
    held: false,
    closed: false,
    leadStatus: null,
    followUp: null,
  },
  completed: {
    label: 'Провёл урок',
    tone: 'lime',
    hint: 'Урок состоялся, решение клиент ещё не принял',
    stage: 'deciding',
    held: true,
    closed: false,
    leadStatus: null,
    followUp: 'outcome',
  },
  thinking: {
    label: 'Думает',
    tone: 'warning',
    hint: 'Урок понравился, взял паузу на решение',
    stage: 'deciding',
    held: true,
    closed: false,
    leadStatus: null,
    followUp: 'return',
  },
  sale: {
    label: 'Купил курс',
    tone: 'positive',
    hint: 'Урок сработал — клиент оплатил курс',
    stage: 'won',
    held: true,
    closed: true,
    leadStatus: 'sale',
    followUp: null,
  },
  bank_declined: {
    label: 'Банк не одобрил',
    tone: 'warning',
    hint: 'Клиент хотел в рассрочку — банк отказал',
    stage: 'blocked',
    held: true,
    closed: true,
    leadStatus: null,
    followUp: 'return',
  },
  rejected: {
    label: 'Отказ',
    tone: 'negative',
    hint: 'Урок провели, покупать не стал',
    stage: 'lost',
    held: true,
    closed: true,
    leadStatus: null,
    followUp: null,
  },
  no_show: {
    label: 'Не вышел на связь',
    tone: 'warning',
    hint: 'Урок назначили, в нужное время клиент не подключился',
    stage: 'missed',
    held: false,
    closed: true,
    leadStatus: null,
    followUp: 'callback',
  },
  canceled: {
    label: 'Отменён',
    tone: 'negative',
    hint: 'Отменили заранее, до урока',
    stage: 'missed',
    held: false,
    closed: true,
    leadStatus: null,
    followUp: 'return',
  },
};

/** Что продажник отмечает по самому уроку — до того, как клиент решил. */
export const TRIAL_EVENT_STATUSES: TrialStatus[] = ['completed', 'no_show', 'canceled'];

/** Чем кончилось решение клиента после урока. */
export const TRIAL_OUTCOME_STATUSES: TrialStatus[] = [
  'sale',
  'thinking',
  'bank_declined',
  'rejected',
];

export function isTrialStatus(value: string): value is TrialStatus {
  return value in TRIAL_STATUS;
}

export function trialStatusMeta(value: string): TrialStatusMeta {
  return (
    TRIAL_STATUS[value as TrialStatus] ?? {
      label: value,
      tone: 'neutral',
      hint: '',
      stage: 'deciding',
      held: false,
      closed: false,
      leadStatus: null,
      followUp: null,
    }
  );
}

export function trialStatusLabel(value: string): string {
  return trialStatusMeta(value).label;
}

/** Урок состоялся: по этому признаку считается доходимость до урока. */
export function wasHeld(status: string): boolean {
  return trialStatusMeta(status).held;
}

export function trialStage(status: string): TrialStage {
  return trialStatusMeta(status).stage;
}

/**
 * Куда переводится клиент следом за исходом урока — и переводится ли вообще.
 *
 * Одно правило на бот и на кабинет, иначе они разойдутся. Двигает заявку
 * только покупка: остальные исходы принадлежат уроку, а не клиенту, и живут
 * в своём поле рядом.
 */
export function leadStatusAfterTrial(status: string): LeadStatus | null {
  return trialStatusMeta(status).leadStatus;
}
