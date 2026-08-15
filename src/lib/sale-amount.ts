/**
 * Разбор суммы продажи, присланной текстом.
 *
 * Продажник пишет сумму на бегу: «260000», «260 000», «260 000 тг», «300$».
 * По умолчанию это валюта компании — её и настраивают один раз в настройках,
 * чтобы каждый раз не уточнять. Указал валюту явно — пересчитаем по курсу
 * Нацбанка на день продажи, а не по тому, что человек помнит наизусть.
 */

/** Как валюту называют в переписке. Порядок важен: ищем самое длинное. */
const CURRENCY_WORDS: { code: string; words: string[] }[] = [
  { code: 'KZT', words: ['тенге', 'тнг', 'тг', 'kzt', '₸'] },
  { code: 'USD', words: ['долларов', 'доллара', 'доллар', 'usd', 'бакс', '$'] },
  { code: 'EUR', words: ['евро', 'eur', '€'] },
  { code: 'RUB', words: ['рублей', 'рубля', 'рубль', 'руб', 'rub', '₽'] },
];

export type ParsedAmount = {
  /** Сколько назвал человек, в названной им валюте. */
  amount: number;
  /** Валюта, которую он назвал явно; null — значит по умолчанию. */
  currency: string | null;
};

export function parseSaleAmount(text: string): ParsedAmount | null {
  const lower = text.toLowerCase();

  // Минус мог оказаться здесь только по ошибке, а отбросив его молча, мы
  // запишем продажу на сумму, которую человек не называл.
  if (/-\s*\d/.test(lower)) return null;

  let currency: string | null = null;
  for (const entry of CURRENCY_WORDS) {
    if (entry.words.some((word) => lower.includes(word))) {
      currency = entry.code;
      break;
    }
  }

  // Пробелы и разделители внутри числа люди ставят по-разному.
  const digits = lower.replace(/[^\d.,]/g, '').replace(',', '.');
  const amount = Number(digits);

  if (!Number.isFinite(amount) || amount <= 0) return null;

  return { amount, currency };
}
