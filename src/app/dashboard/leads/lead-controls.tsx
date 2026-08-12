'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createLead,
  registerSale,
  registerTrial,
  updateLeadStatus,
  type CrmState,
} from '@/app/dashboard/actions';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { IconCheck, IconPlus } from '@/components/ui/icons';
import { Modal, Select } from '@/components/ui/modal';
import { LEAD_STATUS } from '@/lib/labels';
import type { FunnelType } from '@/lib/metrics';
import { toIsoDate } from '@/lib/period';

/**
 * Статус «пробный» существует только в воронке с пробным занятием —
 * товарному бизнесу его предлагать нельзя.
 */
function leadStatusOptions(funnelType: FunnelType) {
  return Object.entries(LEAD_STATUS)
    .filter(([value]) => funnelType === 'trial' || value !== 'trial')
    .map(([value, meta]) => ({ value, label: meta.label }));
}

const PLATFORM_OPTIONS = [
  { value: '', label: 'Не указана' },
  { value: 'meta', label: 'Meta Ads' },
  { value: 'tiktok', label: 'TikTok Ads' },
  { value: 'google', label: 'Google Ads' },
  { value: 'other', label: 'Другое' },
];

/** Кнопка «Добавить лид» с формой в модальном окне. */
export function AddLeadButton({
  creatives,
  funnelType,
}: {
  creatives: { id: string; name: string }[];
  funnelType: FunnelType;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createLead, {} as CrmState);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <IconPlus className="size-4" />
        Добавить лид
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Новый лид"
        description="Заявка, полученная вручную — по телефону, в директе или на встрече."
      >
        {state.success ? (
          <Done message={state.success} onClose={() => setOpen(false)} />
        ) : (
          <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
            <Field label="Имя" name="name" required placeholder="Имя и фамилия" />
            <Field label="Телефон" name="phone" type="tel" placeholder="+7 700 000 00 00" />
            <Field
              label="Источник"
              name="source"
              placeholder="instagram, whatsapp, рекомендация…"
            />
            <Select label="Площадка" name="platform" options={PLATFORM_OPTIONS} />

            {creatives.length > 0 ? (
              <Select
                label="Креатив"
                name="creativeId"
                options={[
                  { value: '', label: 'Без привязки' },
                  ...creatives.map((creative) => ({
                    value: creative.id,
                    label: creative.name,
                  })),
                ]}
                hint="Привязка к креативу — то, из чего собирается сквозная аналитика"
              />
            ) : null}

            <Select
              label="Статус"
              name="status"
              defaultValue="new"
              options={leadStatusOptions(funnelType)}
            />

            <FormMessage error={state.error} />
            <SubmitButton label="Добавить лид" pendingLabel="Сохраняем…" />
          </form>
        )}
      </Modal>
    </>
  );
}

/** Смена статуса лида прямо в строке таблицы. */
export function LeadStatusSelect({
  leadId,
  status,
  funnelType,
}: {
  leadId: string;
  status: string;
  funnelType: FunnelType;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = leadStatusOptions(funnelType);

  const change = (next: string) => {
    setError(null);
    startTransition(async () => {
      const result = await updateLeadStatus(leadId, next);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div>
      <select
        value={status}
        disabled={pending}
        onChange={(event) => change(event.target.value)}
        aria-label="Статус лида"
        className={`h-8 rounded-control border bg-surface-2 px-2 text-[12.5px] text-ink transition-colors focus:outline-none ${
          error ? 'border-negative' : 'border-line hover:border-line-strong'
        } ${pending ? 'opacity-60' : ''}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-[11px] text-negative">{error}</p> : null}
    </div>
  );
}

/** Быстрое оформление продажи или записи на пробное из строки лида. */
export function LeadRowActions({
  leadId,
  leadName,
  funnelType,
}: {
  leadId: string;
  leadName: string;
  funnelType: FunnelType;
}) {
  const [dialog, setDialog] = useState<'sale' | 'trial' | null>(null);

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        {funnelType === 'trial' ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDialog('trial')}>
            Пробный
          </Button>
        ) : null}
        <Button type="button" variant="secondary" size="sm" onClick={() => setDialog('sale')}>
          Продажа
        </Button>
      </div>

      {dialog === 'sale' ? (
        <SaleDialog onClose={() => setDialog(null)} leadId={leadId} leadName={leadName} />
      ) : null}

      {dialog === 'trial' ? (
        <TrialDialog onClose={() => setDialog(null)} leadId={leadId} leadName={leadName} />
      ) : null}
    </>
  );
}

function SaleDialog({
  onClose,
  leadId,
  leadName,
}: {
  onClose: () => void;
  leadId: string;
  leadName: string;
}) {
  const [state, formAction] = useActionState(registerSale, {} as CrmState);

  return (
    <Modal
      open
      onClose={onClose}
      title="Оформить продажу"
      description={`Клиент: ${leadName || 'без имени'}`}
    >
      {state.success ? (
        <Done message={state.success} onClose={onClose} />
      ) : (
        <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
          <input type="hidden" name="leadId" value={leadId} />
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
            options={[
              { value: 'paid', label: 'Оплачено' },
              { value: 'pending', label: 'Ожидает оплаты' },
            ]}
            hint="Оплаченная продажа сразу переводит лид в статус «продажа»"
          />
          <FormMessage error={state.error} />
          <SubmitButton label="Записать продажу" pendingLabel="Сохраняем…" />
        </form>
      )}
    </Modal>
  );
}

function TrialDialog({
  onClose,
  leadId,
  leadName,
}: {
  onClose: () => void;
  leadId: string;
  leadName: string;
}) {
  const [state, formAction] = useActionState(registerTrial, {} as CrmState);

  return (
    <Modal
      open
      onClose={onClose}
      title="Записать на пробное"
      description={`Клиент: ${leadName || 'без имени'}`}
    >
      {state.success ? (
        <Done message={state.success} onClose={onClose} />
      ) : (
        <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
          <input type="hidden" name="leadId" value={leadId} />
          <Field
            label="Дата пробного"
            name="date"
            type="date"
            required
            defaultValue={toIsoDate(new Date())}
          />
          <Select
            label="Статус"
            name="status"
            defaultValue="scheduled"
            options={[
              { value: 'scheduled', label: 'Запланирован' },
              { value: 'completed', label: 'Проведён' },
            ]}
          />
          <FormMessage error={state.error} />
          <SubmitButton label="Записать" pendingLabel="Сохраняем…" />
        </form>
      )}
    </Modal>
  );
}

/** Экран «готово»: окно не закрывается само, чтобы результат было видно. */
export function Done({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="px-5 py-8 text-center sm:px-6">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-positive/30 bg-positive/10 text-positive">
        <IconCheck className="size-5" />
      </div>
      <p className="mt-4 text-[14.5px] text-ink">{message}</p>
      <Button type="button" className="mt-6 w-full" onClick={onClose}>
        Закрыть
      </Button>
    </div>
  );
}

export function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
