/**
 * Статусы онлайн-урока — единственное место, где описан его путь.
 *
 * Пробный урок покупают и проводят по видеосвязи, поэтому «не пришёл»
 * означает не пустой стул, а молчание в назначенное время. Факт занятия и
 * решение клиента разведены намеренно: между уроком и покупкой обычно
 * проходит день-два, и продажнику нужно чем-то отметить сам урок.
 *
 * Порядок массива — порядок движения; на нём строятся все списки.
 */

export const TRIAL_STATUS_ORDER = [
  'scheduled',
  'completed',
  'sale',
  'rejected',
  'no_show',
  'canceled',
] as const;

export type TrialStatus = (typeof TRIAL_STATUS_ORDER)[number];

export type TrialTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'lime';

type TrialStatusMeta = {
  label: string;
  tone: TrialTone;
  hint: string;
  /** Урок состоялся — считается в конверсии «дошли до урока». */
  held: boolean;
  /** Итог подведён: урок больше не в работе. */
  closed: boolean;
};

export const TRIAL_STATUS: Record<TrialStatus, TrialStatusMeta> = {
  scheduled: {
    label: 'Записан',
    tone: 'neutral',
    hint: 'Время согласовано, продажник назначен',
    held: false,
    closed: false,
  },
  completed: {
    label: 'Проведён',
    tone: 'lime',
    hint: 'Урок состоялся, решение клиент ещё не принял',
    held: true,
    closed: false,
  },
  sale: {
    label: 'Купил курс',
    tone: 'positive',
    hint: 'Урок сработал — клиент оплатил курс',
    held: true,
    closed: true,
  },
  rejected: {
    label: 'Не одобрил',
    tone: 'negative',
    hint: 'Урок провели, покупать не стал',
    held: true,
    closed: true,
  },
  no_show: {
    label: 'Не пришёл',
    tone: 'warning',
    hint: 'Не вышел на связь в назначенное время',
    held: false,
    closed: true,
  },
  canceled: {
    label: 'Отменён',
    tone: 'negative',
    hint: 'Отменили заранее, до урока',
    held: false,
    closed: true,
  },
};

export function isTrialStatus(value: string): value is TrialStatus {
  return value in TRIAL_STATUS;
}

export function trialStatusMeta(value: string): TrialStatusMeta {
  return (
    TRIAL_STATUS[value as TrialStatus] ?? {
      label: value,
      tone: 'neutral',
      hint: '',
      held: false,
      closed: false,
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
