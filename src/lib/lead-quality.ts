/**
 * Оценка клиента продажником: горячий или холодный.
 *
 * Нужна не для отчёта, а для рекламы. Событие о покупке учит алгоритм искать
 * похожих людей — и если покупатель попал случайно, обучать на нём вредно:
 * Meta пойдёт искать таких же случайных. Поэтому тот, кто с клиентом говорил,
 * ставит отметку, а отправляет её в кабинет таргетолог.
 */

export const LEAD_QUALITY_ORDER = ['hot', 'cold'] as const;

export type LeadQuality = (typeof LEAD_QUALITY_ORDER)[number];

export const LEAD_QUALITY: Record<
  LeadQuality,
  { label: string; icon: string; hint: string; tone: 'positive' | 'neutral' }
> = {
  hot: {
    label: 'Горячий',
    icon: '\u{1F525}',
    hint: 'Целевой клиент — на таких рекламу учить стоит',
    tone: 'positive',
  },
  cold: {
    label: 'Холодный',
    icon: '\u{2744}\u{FE0F}',
    hint: 'Случайный покупатель — в рекламный кабинет не отправляем',
    tone: 'neutral',
  },
};

export function isLeadQuality(value: string): value is LeadQuality {
  return value in LEAD_QUALITY;
}

/** «🔥 Горячий» — одинаково в боте и в кабинете. */
export function qualityBadge(value: string | null): string {
  if (!value || !isLeadQuality(value)) return '';
  return `${LEAD_QUALITY[value].icon} ${LEAD_QUALITY[value].label}`;
}
