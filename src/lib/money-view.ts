/**
 * В какой валюте показывать рекламные деньги.
 *
 * У компании две валюты, и это не прихоть: рекламный кабинет выставляет счёт
 * в своей (у нас доллары), а продажи приходят в тенге. Всё, что считается от
 * расхода — цена лида, цена клика, цена клиента, CPM — это деньги площадки, и
 * директор сверяет их с Ads Manager. Всё, что от выручки, — деньги бизнеса.
 *
 * Суммы в базе хранятся в валюте продаж: только так прибыль и ROAS вообще
 * имеют смысл. Рядом лежит исходная сумма из кабинета (`spendSource`), и
 * показать можно любую из двух — считаются они одинаково.
 *
 * Помощник один на все разделы намеренно: пока эта развилка жила в каждой
 * странице отдельно, страница креатива осталась со старой валютой и
 * подписывала тенге долларом.
 */

export type SpendRow = {
  /** Расход в валюте продаж — в ней ведётся вся арифметика. */
  spend: number;
  /** Он же в валюте рекламного кабинета. null — валюты совпадают. */
  spendSource: number | null;
};

export type MoneyView = {
  /** Валюта крупных цифр в рекламных разделах. */
  adCurrency: string;
  /** Вторая валюта — та, что идёт мелкой подписью. */
  otherCurrency: string;
  /** Показывать ли вторую строку вообще. */
  showBoth: boolean;
  /** Расход строки в валюте крупных цифр. */
  spendOf(row: SpendRow): number;
  /** Он же во второй валюте. */
  otherSpendOf(row: SpendRow): number;
};

export function moneyView(
  /** Что директор выбрал в настройках как валюту рекламных отчётов. */
  chosen: string,
  /** Валюта продаж — в ней хранятся все суммы. */
  salesCurrency: string,
  /** Валюта рекламного кабинета; null — если её нет или кабинетов несколько. */
  accountCurrency: string | null,
): MoneyView {
  // Показывать исходные суммы кабинета можно, только если директор выбрал
  // именно его валюту. В остальных случаях крупно идёт валюта продаж: пересчёт
  // в третью валюту мы не делаем, а подписать одно другим — соврать.
  const fromSource = accountCurrency !== null && chosen === accountCurrency;
  const differ = accountCurrency !== null && accountCurrency !== salesCurrency;

  return {
    adCurrency: fromSource ? accountCurrency : salesCurrency,
    otherCurrency: fromSource ? salesCurrency : (accountCurrency ?? salesCurrency),
    showBoth: differ,
    // Пустой spendSource означает «пересчёта не было», то есть сумма уже в
    // валюте кабинета. Подставлять здесь ноль нельзя: раздел молча показал бы
    // нулевую статистику вместо цифр, что однажды и произошло.
    spendOf: (row) => (fromSource ? (row.spendSource ?? row.spend) : row.spend),
    otherSpendOf: (row) => (fromSource ? row.spend : (row.spendSource ?? row.spend)),
  };
}

/** Сумма на единицу: цена лида, клика, клиента. Ноль знаменателя — прочерк. */
export function per(amount: number, count: number): number | null {
  return count ? amount / count : null;
}
