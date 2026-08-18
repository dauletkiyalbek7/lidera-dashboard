import { trialWords } from '@/lib/trial-term';

/**
 * Статусы лида — единственное место, где описан путь клиента.
 *
 * Менеджер оценивает лид результатом контакта, а не абстрактной «работой»:
 * дозвонился или нет, целевой или нет, думает или отказал. Отсюда берут набор
 * и выпадающие списки, и валидация серверных действий, и разбор по статусам.
 *
 * Порядок массива — порядок движения по воронке; на нём же строятся списки,
 * чтобы менеджер видел статусы в одной и той же последовательности везде.
 */

export const LEAD_STATUS_ORDER = [
  'new',
  'no_answer',
  'contacted',
  'in_progress',
  'thinking',
  'trial',
  'sale',
  'rejected',
] as const;

export type LeadStatus = (typeof LEAD_STATUS_ORDER)[number];

/**
 * Стадия — крупная группа статусов для сводок.
 * По ней считаются плитки «недозвон / в работе / купили / потеряны».
 */
export type LeadStage = 'new' | 'unreached' | 'working' | 'won' | 'lost';

export type LeadStatusTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'lime';

type LeadStatusMeta = {
  label: string;
  tone: LeadStatusTone;
  stage: LeadStage;
  /** Был ли живой контакт с человеком. */
  reached: boolean;
  /** Короткое пояснение — показываем в разборе по статусам. */
  hint: string;
  /** Статус существует только в воронке с пробным занятием. */
  onlyTrialFunnel?: true;
};

export const LEAD_STATUS: Record<LeadStatus, LeadStatusMeta> = {
  new: {
    label: 'Новый',
    tone: 'neutral',
    stage: 'new',
    reached: false,
    hint: 'Заявка пришла, менеджер её ещё не трогал',
  },
  no_answer: {
    label: 'Игнор',
    tone: 'warning',
    stage: 'unreached',
    reached: false,
    hint: 'Не отвечает — нужны повторные попытки',
  },
  contacted: {
    label: 'Дозвон',
    tone: 'lime',
    stage: 'working',
    reached: true,
    hint: 'Разговор состоялся, интерес выясняется',
  },
  in_progress: {
    label: 'В работе',
    tone: 'lime',
    stage: 'working',
    reached: true,
    hint: 'Переписка или переговоры продолжаются',
  },
  thinking: {
    label: 'Думает',
    tone: 'warning',
    stage: 'working',
    reached: true,
    hint: 'Взял паузу на решение — нужен повторный касание',
  },
  trial: {
    label: 'Пробный',
    tone: 'lime',
    stage: 'working',
    reached: true,
    hint: 'Записан на пробное занятие',
    onlyTrialFunnel: true,
  },
  sale: {
    label: 'Купил',
    tone: 'positive',
    stage: 'won',
    reached: true,
    hint: 'Оплата прошла',
  },
  rejected: {
    label: 'Отказ',
    tone: 'negative',
    stage: 'lost',
    reached: true,
    hint: 'Поговорили — покупать не будет',
  },
};

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'Новые',
  unreached: 'Игнор',
  working: 'В работе',
  won: 'Купили',
  lost: 'Потеряны',
};

export function isLeadStatus(value: string): value is LeadStatus {
  return value in LEAD_STATUS;
}

export function leadStatusMeta(value: string): LeadStatusMeta {
  return (
    LEAD_STATUS[value as LeadStatus] ?? {
      label: value,
      tone: 'neutral',
      stage: 'working',
      reached: false,
      hint: '',
    }
  );
}

/**
 * Подпись и подсказка статуса для конкретной компании.
 *
 * Все статусы, кроме `trial`, называются одинаково у всех. А промежуточный
 * шаг каждая компания зовёт по-своему: у школы это «Пробный», у Дарына —
 * «Вебинар». Поэтому подпись берут отсюда, а не из справочника напрямую.
 */
export function leadStatusFor(value: string, term: unknown): LeadStatusMeta {
  const meta = leadStatusMeta(value);
  if (value !== 'trial') return meta;

  const words = trialWords(term);
  return { ...meta, label: words.leadStatus, hint: words.leadStatusHint };
}

export function leadStatusLabel(value: string, term: unknown): string {
  return leadStatusFor(value, term).label;
}

/**
 * Был ли реальный контакт с лидом. На этом держится шаг воронки «обработан»:
 * отказ — тоже обработанный лид, а недозвон и нецелевой — нет.
 */
export function isReached(status: string): boolean {
  return leadStatusMeta(status).reached;
}

export function leadStage(status: string): LeadStage {
  return leadStatusMeta(status).stage;
}

/**
 * Лиды, до которых никто не дотянулся дольше суток: пришли и остались
 * «новыми». Для директора это первый признак, что отдел продаж не успевает.
 */
export function countUntouched(
  leads: { status: string; created_at: string }[],
  hours = 24,
): number {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return leads.filter(
    (lead) => lead.status === 'new' && new Date(lead.created_at).getTime() < cutoff,
  ).length;
}

/** Статусы, доступные компании: без пробного шаг «Пробный» не предлагаем. */
export function leadStatusesFor(funnelType: 'trial' | 'direct'): LeadStatus[] {
  return LEAD_STATUS_ORDER.filter(
    (status) => funnelType === 'trial' || !LEAD_STATUS[status].onlyTrialFunnel,
  );
}
