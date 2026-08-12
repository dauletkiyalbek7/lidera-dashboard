'use client';

import { useState, useTransition, useActionState } from 'react';

import {
  registerSale,
  updateSaleStatus,
  type CrmState,
} from '@/app/dashboard/actions';
import { Done, SubmitButton } from '@/app/dashboard/leads/lead-controls';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { IconPlus } from '@/components/ui/icons';
import { Modal, Select } from '@/components/ui/modal';
import { SALE_STATUS } from '@/lib/labels';
import { toIsoDate } from '@/lib/period';

const SALE_STATUS_OPTIONS = Object.entries(SALE_STATUS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

/**
 * Продажа без привязки к лиду тоже нужна — например, покупка в офисе.
 * Но привязанная продажа участвует в сквозной аналитике, поэтому список лидов
 * стоит первым.
 */
export function AddSaleButton({
  leads,
}: {
  leads: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(registerSale, {} as CrmState);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <IconPlus className="size-4" />
        Добавить продажу
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Новая продажа"
        description="Привяжите продажу к лиду, чтобы она попала в аналитику креативов."
      >
        {state.success ? (
          <Done message={state.success} onClose={() => setOpen(false)} />
        ) : (
          <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
            <Select
              label="Лид"
              name="leadId"
              options={[
                { value: '', label: 'Без привязки к лиду' },
                ...leads.map((lead) => ({ value: lead.id, label: lead.label })),
              ]}
              hint={
                leads.length === 0
                  ? 'За выбранный период лидов нет — продажу можно записать без привязки'
                  : undefined
              }
            />
            <Field label="Товар или услуга" name="product" placeholder="Название продукта" />
            <Field
              label="Сумма, ₸"
              name="amount"
              type="number"
              min={0}
              step={100}
              required
              placeholder="0"
            />
            <Field
              label="Дата продажи"
              name="saleDate"
              type="date"
              required
              defaultValue={toIsoDate(new Date())}
            />
            <Select
              label="Статус"
              name="status"
              defaultValue="paid"
              options={SALE_STATUS_OPTIONS}
            />
            <FormMessage error={state.error} />
            <SubmitButton label="Записать продажу" pendingLabel="Сохраняем…" />
          </form>
        )}
      </Modal>
    </>
  );
}

export function SaleStatusSelect({ saleId, status }: { saleId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = (next: string) => {
    setError(null);
    startTransition(async () => {
      const result = await updateSaleStatus(saleId, next);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div>
      <select
        value={status}
        disabled={pending}
        onChange={(event) => change(event.target.value)}
        aria-label="Статус продажи"
        className={`h-8 rounded-control border bg-surface-2 px-2 text-[12.5px] text-ink transition-colors focus:outline-none ${
          error ? 'border-negative' : 'border-line hover:border-line-strong'
        } ${pending ? 'opacity-60' : ''}`}
      >
        {SALE_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-[11px] text-negative">{error}</p> : null}
    </div>
  );
}
