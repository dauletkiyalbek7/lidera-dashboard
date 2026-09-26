/**
 * Откуда пришёл лид — одной понятной подписью.
 *
 * Площадка (`meta`, `google`) отвечает на вопрос «чей кабинет», а человеку в
 * списке нужен ответ на другой — «где он нас увидел». Instagram и Facebook
 * живут в одном кабинете Meta, YouTube — в кабинете Google, и различает их
 * только метка `utm_source` в ссылке объявления.
 *
 * Поэтому метка идёт первой, площадка — запасным вариантом, а поток («сайт»,
 * «WhatsApp») — последним: он говорит, каким способом человек обратился, а не
 * откуда он про нас узнал.
 */

/** Метки, которые ставят в ссылках. Слева — как пишут, справа — как читаем. */
const UTM_LABELS: Record<string, string> = {
  ig: 'Instagram',
  insta: 'Instagram',
  instagram: 'Instagram',
  fb: 'Facebook',
  facebook: 'Facebook',
  meta: 'Meta',
  yt: 'YouTube',
  youtube: 'YouTube',
  google: 'YouTube',
  adwords: 'YouTube',
  tiktok: 'TikTok',
  tt: 'TikTok',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};

/** Площадки кабинетов — когда метки нет, но кабинет известен. */
const PLATFORM_LABELS: Record<string, string> = {
  meta: 'Meta Ads',
  // Google здесь читается как YouTube: на нём крутят только видео, и человек
  // в списке ищет то слово, которым сам зовёт этот канал. Появится поиск по
  // Google — разведём по метке ссылки, она это уже умеет.
  google: 'YouTube',
  tiktok: 'TikTok Ads',
  other: 'Другое',
};

/** Потоки — самый грубый ответ, когда больше ничего не известно. */
const SOURCE_LABELS: Record<string, string> = {
  site: 'Сайт',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  manual: 'Вручную',
};

export type LeadOrigin = {
  platform?: string | null;
  source?: string | null;
  utmSource?: string | null;
  /** Название потока, которым заявка пришла: «TikTok сайт», «TikTok форма». */
  sourceName?: string | null;
  /** Площадка самого потока — не заявки. Общий поток сайта её не знает. */
  sourcePlatform?: string | null;
};

export function originLabel(lead: LeadOrigin): string {
  // Поток знает про заявку больше всех: он различает сайт и моментальную
  // форму одной площадки, чего метка в ссылке не умеет. Но только когда он
  // заведён под конкретный кабинет: общая «Форма на сайте» принимает рекламу
  // всех площадок сразу и на вопрос «откуда человек» не отвечает.
  const named = lead.sourcePlatform ? PLATFORM_LABELS[lead.sourcePlatform] : null;
  if (named && lead.sourceName?.trim()) return lead.sourceName.trim();

  const utm = lead.utmSource?.trim().toLowerCase();
  if (utm && UTM_LABELS[utm]) return UTM_LABELS[utm];

  const platform = lead.platform?.trim().toLowerCase();
  if (platform && PLATFORM_LABELS[platform]) return PLATFORM_LABELS[platform];

  // Метка есть, но незнакомая: показать как записали честнее, чем спрятать —
  // так видно, что в ссылке объявления стоит что-то своё.
  if (utm) return utm;

  const source = lead.source?.trim().toLowerCase();
  if (source && SOURCE_LABELS[source]) return SOURCE_LABELS[source];

  return lead.source || '—';
}
