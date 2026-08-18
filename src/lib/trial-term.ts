/**
 * Как компания называет промежуточный шаг воронки.
 *
 * Форма воронки у онлайн-школы и у Дарына одна: заявка → событие, на котором
 * продают → покупка. Различается только само событие — пробный урок один на
 * один или ежедневный вебинар на всех сразу. Поведение, статусы и роли при
 * этом совпадают, поэтому термин отделён от типа воронки: `funnel_type`
 * решает, как воронка работает, `trial_term` — каким словом её называют.
 *
 * Слово хранится перечислением, а не свободным текстом: в заголовке раздела,
 * в колонке таблицы и в подписи статуса нужны разные падежи и числа, а
 * склонять русское слово на лету нечем.
 */

export const TRIAL_TERM_ORDER = ['trial', 'webinar'] as const;

export type TrialTerm = (typeof TRIAL_TERM_ORDER)[number];

type TrialTermWords = {
  /** Раздел меню и заголовок страницы. */
  section: string;
  /** Колонка таблицы и подпись плитки — там, где место ограничено. */
  column: string;
  /** Одно событие, именительный падеж. */
  one: string;
  /** «записан на …», «дошёл до …» — родительный/винительный после предлога. */
  accusative: string;
  /** Строка воронки на главной. */
  funnelTitle: string;
  /** Подпись среднего шага воронки. */
  middleStep: string;
  /** Подпись статуса лида `trial` и подсказка к нему. */
  leadStatus: string;
  leadStatusHint: string;
  /** Чем занят продажник — для карточек команды. */
  sellerDuty: string;
};

const WORDS: Record<TrialTerm, TrialTermWords> = {
  trial: {
    section: 'Пробные уроки',
    column: 'Пробные',
    one: 'Пробный урок',
    accusative: 'пробный урок',
    funnelTitle: 'Лид → Пробный → Продажа',
    middleStep: 'Пробные проведены',
    leadStatus: 'Пробный',
    leadStatusHint: 'Записан на пробное занятие',
    sellerDuty: 'Проводит пробные уроки и закрывает продажи',
  },
  webinar: {
    section: 'Вебинары',
    column: 'Вебинары',
    one: 'Вебинар',
    accusative: 'вебинар',
    funnelTitle: 'Лид → Вебинар → Продажа',
    middleStep: 'Дошли до вебинара',
    leadStatus: 'Вебинар',
    leadStatusHint: 'Записан на вебинар',
    sellerDuty: 'Ведёт вебинары и закрывает продажи',
  },
};

export function isTrialTerm(value: unknown): value is TrialTerm {
  return typeof value === 'string' && TRIAL_TERM_ORDER.includes(value as TrialTerm);
}

/**
 * Слова для компании. Неизвестное значение — это старая строка в базе или
 * опечатка в форме; интерфейс от такого падать не должен, поэтому молча
 * возвращаем термин по умолчанию.
 */
export function trialTerm(value: unknown): TrialTerm {
  return isTrialTerm(value) ? value : 'trial';
}

export function trialWords(value: unknown): TrialTermWords {
  return WORDS[trialTerm(value)];
}

/** Подписи для выбора термина в настройках. */
export const TRIAL_TERM_HINTS: Record<TrialTerm, string> = {
  trial: 'Занятие один на один: онлайн-школы, репетиторы, услуги',
  webinar: 'Общая встреча по расписанию: вебинар, день открытых дверей',
};
