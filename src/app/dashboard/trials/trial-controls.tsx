'use client';

import { useState, useTransition } from 'react';

import { updateTrialStatus } from '@/app/dashboard/actions';
import { SaleDialog } from '@/app/dashboard/leads/lead-controls';
import { formatMoney } from '@/lib/format';
import { TRIAL_STATUS } from '@/lib/labels';

const TRIAL_STATUS_OPTIONS = Object.entries(TRIAL_STATUS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

/**
 * Статус пробного меняется прямо в списке: «проведён» сразу попадает
 * в воронку и в аналитику креативов.
 *
 * «Купил курс» — не просто отметка: без суммы и оценки клиента продажа не
 * попадёт ни в выручку, ни в рекламный кабинет. Поэтому здесь сразу открывается
 * та же форма, что по кнопке «Продажа» в разделе «Лиды», — так же, как это
 * делает бот, спрашивая сумму следом за отметкой о покупке.
 */
export function TrialStatusSelect({
  trialId,
  status,
  leadId,
  leadName,
  saleAmount,
  currency,
}: {
  trialId: string;
  status: string;
  leadId: string | null;
  leadName: string | null;
  /** Сумма уже проведённого чека. null — продажи по клиенту ещё нет. */
  saleAmount: number | null;
  currency: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [askSale, setAskSale] = useState(false);

  const change = (next: string) => {
    setError(null);
    startTransition(async () => {
      const result = await updateTrialStatus(trialId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      // Чек по клиенту уже есть — второй раз сумму не спрашиваем: продажник
      // мог отметить покупку в боте, а база вторую оплату и не примет.
      if (next === 'sale' && leadId && saleAmount === null) setAskSale(true);
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <select
          value={status}
          disabled={pending}
          onChange={(event) => change(event.target.value)}
          aria-label="Статус пробного"
          className={`h-8 rounded-control border bg-surface-2 px-2 text-[12.5px] text-ink transition-colors focus:outline-none ${
            error ? 'border-negative' : 'border-line hover:border-line-strong'
          } ${pending ? 'opacity-60' : ''}`}
        >
          {TRIAL_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {saleAmount !== null ? (
          <span className="tabular text-[12.5px] font-medium text-positive">
            {formatMoney(saleAmount, { currency })}
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-[11px] text-negative">{error}</p> : null}

      {askSale && leadId ? (
        <SaleDialog
          onClose={() => setAskSale(false)}
          leadId={leadId}
          leadName={leadName ?? ''}
          currency={currency}
        />
      ) : null}
    </div>
  );
}
