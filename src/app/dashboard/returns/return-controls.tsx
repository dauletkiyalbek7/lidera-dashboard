'use client';

import { useActionState, useState } from 'react';

import { Done, SubmitButton } from '@/app/dashboard/leads/lead-controls';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { currencySymbol, formatMoney } from '@/lib/format';
import { registerReturn, type ReturnState } from './actions';

/**
 * Оформление возврата по конкретной продаже.
 *
 * Сумму подставляем полную и разрешаем уменьшить: чаще возвращают всё, а
 * набирать заново то, что уже известно, — лишний повод ошибиться.
 */
export function RefundButton({
  saleId,
  saleAmount,
  leadName,
  currency,
}: {
  saleId: string;
  saleAmount: number;
  leadName: string | null;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(registerReturn, {} as ReturnState);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Возврат
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Оформить возврат"
        description={`${leadName ?? 'Продажа'} — ${formatMoney(saleAmount, { currency })}. Продажа уйдёт из выручки, запись останется в истории.`}
      >
        {state.success ? (
          <Done message={state.success} onClose={() => setOpen(false)} />
        ) : (
          <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
            <input type="hidden" name="saleId" value={saleId} />
            <Field
              label={`Сумма возврата, ${currencySymbol(currency)}`}
              name="amount"
              type="number"
              min={0}
              step={100}
              required
              defaultValue={saleAmount}
            />
            <Field
              label="Причина"
              name="reason"
              placeholder="Почему вернули деньги"
            />
            <FormMessage error={state.error} />
            <SubmitButton label="Оформить возврат" pendingLabel="Оформляем…" />
          </form>
        )}
      </Modal>
    </>
  );
}
