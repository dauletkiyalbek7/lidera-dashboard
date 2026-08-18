/**
 * Производные рекламные и финансовые метрики.
 * Единственное место, где они считаются — дублировать формулы нельзя.
 */

import { trialWords } from '@/lib/trial-term';

/** Деление, безопасное к нулевому знаменателю. */
export function safeDivide(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

/** Цена лида. */
export const costPerLead = (spend: number, leads: number) => safeDivide(spend, leads);

/** Цена привлечения клиента. */
export const costPerAcquisition = (spend: number, sales: number) =>
  safeDivide(spend, sales);

/** Возврат на рекламные расходы: сколько тенге выручки на тенге расхода. */
export const roas = (revenue: number, spend: number) => safeDivide(revenue, spend);

/** Рентабельность инвестиций в рекламу, %. */
export const roi = (revenue: number, spend: number) =>
  safeDivide(revenue - spend, spend) * 100;

/** Конверсия из лида в продажу, %. */
export const conversionRate = (sales: number, leads: number) =>
  safeDivide(sales, leads) * 100;

/** Кликабельность, %. */
export const clickThroughRate = (clicks: number, impressions: number) =>
  safeDivide(clicks, impressions) * 100;

export const costPerClick = (spend: number, clicks: number) => safeDivide(spend, clicks);

export const costPerMille = (spend: number, impressions: number) =>
  safeDivide(spend, impressions) * 1000;

/** Средний чек. */
export const averageCheck = (revenue: number, sales: number) => safeDivide(revenue, sales);

export type PerformanceInput = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  /** Промежуточный шаг воронки trial: проведённые пробные занятия. */
  trials: number;
  /** Промежуточный шаг воронки direct: лиды, с которыми состоялся контакт. */
  processed: number;
  sales: number;
  revenue: number;
};

export type PerformanceSummary = PerformanceInput & {
  cpl: number;
  cac: number;
  ctr: number;
  cpc: number;
  cpm: number;
  roas: number;
  roi: number;
  conversion: number;
  averageCheck: number;
  profit: number;
};

/** Полный набор показателей для карточек и таблиц. */
export function summarize(input: PerformanceInput): PerformanceSummary {
  return {
    ...input,
    cpl: costPerLead(input.spend, input.leads),
    cac: costPerAcquisition(input.spend, input.sales),
    ctr: clickThroughRate(input.clicks, input.impressions),
    cpc: costPerClick(input.spend, input.clicks),
    cpm: costPerMille(input.spend, input.impressions),
    roas: roas(input.revenue, input.spend),
    roi: roi(input.revenue, input.spend),
    conversion: conversionRate(input.sales, input.leads),
    averageCheck: averageCheck(input.revenue, input.sales),
    profit: input.revenue - input.spend,
  };
}

export const emptyPerformance: PerformanceInput = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  leads: 0,
  trials: 0,
  processed: 0,
  sales: 0,
  revenue: 0,
};

/**
 * Тип воронки компании. Онлайн-школа ведёт лид через пробное занятие,
 * товарный бизнес продаёт сразу — промежуточный шаг у них разный.
 */
export type FunnelType = 'trial' | 'direct';

export const FUNNEL_LABELS: Record<FunnelType, {
  title: string;
  middleStep: string;
  middleColumn: string;
  hint: string;
}> = {
  trial: {
    title: 'Лид → Пробный → Продажа',
    middleStep: 'Пробные проведены',
    middleColumn: 'Пробные',
    hint: 'С пробным занятием — для онлайн-школ и услуг',
  },
  direct: {
    title: 'Лид → Контакт → Продажа',
    middleStep: 'Состоялся контакт',
    middleColumn: 'Дозвон',
    hint: 'Без пробного — для товарного бизнеса и прямых продаж',
  },
};

/**
 * Подписи воронки для конкретной компании.
 *
 * `FUNNEL_LABELS` описывает сам тип воронки и потому нейтрален — он нужен
 * там, где тип выбирают. А на рабочих экранах шаг называют так, как принято
 * у этой компании: у школы «Пробный», у Дарына «Вебинар». Форма воронки при
 * этом одна и та же, меняется только слово.
 */
export function funnelLabels(
  funnelType: FunnelType,
  term: unknown,
): (typeof FUNNEL_LABELS)[FunnelType] {
  if (funnelType !== 'trial') return FUNNEL_LABELS[funnelType];

  const words = trialWords(term);
  return {
    title: words.funnelTitle,
    middleStep: words.middleStep,
    middleColumn: words.column,
    hint: FUNNEL_LABELS.trial.hint,
  };
}

/** Значение промежуточного шага воронки для выбранного типа. */
export function middleStepValue(
  funnelType: FunnelType,
  performance: Pick<PerformanceInput, 'trials' | 'processed'>,
): number {
  return funnelType === 'trial' ? performance.trials : performance.processed;
}

/**
 * Оценка креатива по ROAS. Именно она отвечает на главный вопрос платформы:
 * дешёвый лид ещё не значит хорошая реклама.
 */
export type CreativeVerdict = 'excellent' | 'good' | 'weak' | 'bad';

export function verdictByRoas(value: number): CreativeVerdict {
  if (value >= 4) return 'excellent';
  if (value >= 2) return 'good';
  if (value >= 1) return 'weak';
  return 'bad';
}

export const verdictLabels: Record<CreativeVerdict, string> = {
  excellent: 'Отличный',
  good: 'Хороший',
  weak: 'Слабый',
  bad: 'Убыточный',
};
