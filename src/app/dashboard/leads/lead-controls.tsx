'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import {
  checkAvailability,
  createLead,
  distributeNow,
  registerSale,
  registerTrial,
  updateLeadStatus,
  type CrmState,
} from '@/app/dashboard/actions';
import { assignLead } from '@/app/dashboard/team/actions';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { IconCheck, IconPlus } from '@/components/ui/icons';
import { Modal, Select } from '@/components/ui/modal';
import { LEAD_STATUS, leadStatusesFor } from '@/lib/lead-status';
import type { FunnelType } from '@/lib/metrics';
import { toIsoDate } from '@/lib/period';

/** Порядок и состав статусов — из общего справочника, а не из локального списка. */
function leadStatusOptions(funnelType: FunnelType) {
  return leadStatusesFor(funnelType).map((value) => ({
    value,
    label: LEAD_STATUS[value].label,
  }));
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

/**
 * Ответственный менеджер прямо в строке. Пока лидов раздаёт директор руками;
 * когда появится авто-раздача, это же поле будет показывать её результат.
 */
export function LeadOwnerSelect({
  leadId,
  assignedTo,
  employees,
}: {
  leadId: string;
  assignedTo: string | null;
  employees: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = (next: string) => {
    setError(null);
    startTransition(async () => {
      const result = await assignLead(leadId, next);
      if (result.error) setError(result.error);
    });
  };

  if (employees.length === 0) {
    return <span className="text-[12.5px] text-faint">нет сотрудников</span>;
  }

  return (
    <div>
      <select
        value={assignedTo ?? ''}
        disabled={pending}
        onChange={(event) => change(event.target.value)}
        aria-label="Ответственный менеджер"
        className={`h-8 max-w-[160px] rounded-control border bg-surface-2 px-2 text-[12.5px] text-ink transition-colors focus:outline-none ${
          error ? 'border-negative' : 'border-line hover:border-line-strong'
        } ${pending ? 'opacity-60' : ''}`}
      >
        <option value="">Не назначен</option>
        {employees.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.name}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-[11px] text-negative">{error}</p> : null}
    </div>
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

/**
 * «Раздать сейчас» — ночная очередь.
 *
 * Ночью смен нет и заявки копятся нераспределёнными. Утром одна кнопка
 * раскидывает их поровну между теми, кто уже открыл смену.
 */
export function DistributeButton({ queued }: { queued: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<CrmState | null>(null);

  const run = () => {
    setMessage(null);
    startTransition(async () => setMessage(await distributeNow()));
  };

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" onClick={run} disabled={pending || !queued}>
        {pending ? 'Раздаём…' : `Раздать сейчас${queued ? ` (${queued})` : ''}`}
      </Button>
      {message?.error ? (
        <span className="text-[12px] text-negative">{message.error}</span>
      ) : null}
      {message?.success ? (
        <span className="text-[12px] text-lime">{message.success}</span>
      ) : null}
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
            Урок
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

/**
 * Запись на онлайн-урок.
 *
 * Менеджер уже согласовал время с клиентом, поэтому сначала выбирает час, и
 * только потом — кто из продажников в этот час свободен. Занятые показаны
 * серым: выбрать их нельзя, но видно, что человек есть и просто занят.
 */
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
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [time, setTime] = useState('18:00');
  const [sellers, setSellers] = useState<Seller[] | null>(null);
  const [checking, startChecking] = useTransition();

  useEffect(() => {
    startChecking(async () => {
      const result = await checkAvailability(date, time);
      setSellers(result.sellers);
    });
  }, [date, time]);

  const free = sellers?.filter((seller) => !seller.busy) ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title="Записать на онлайн-урок"
      description={`Клиент: ${leadName || 'без имени'}`}
    >
      {state.success ? (
        <Done message={state.success} onClose={onClose} />
      ) : (
        <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
          <input type="hidden" name="leadId" value={leadId} />

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Дата урока"
              name="date"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <Field
              label="Время"
              name="time"
              type="time"
              required
              step={300}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>

          <div>
            <label
              htmlFor="sellerId"
              className="block text-[13px] font-medium text-ink-soft"
            >
              Продажник
            </label>
            <select
              id="sellerId"
              name="sellerId"
              required
              disabled={checking || free.length === 0}
              className="mt-1.5 h-10 w-full rounded-control border border-line bg-surface-2 px-3 text-[14px] text-ink transition-colors hover:border-line-strong focus:outline-none disabled:opacity-60"
            >
              {sellers === null || checking ? (
                <option value="">Смотрим, кто свободен…</option>
              ) : null}
              {sellers?.map((seller) => (
                <option key={seller.id} value={seller.id} disabled={seller.busy}>
                  {seller.fullName}
                  {seller.busy ? ' — занят в это время' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[12px] text-muted">
              {sellers === null || checking
                ? 'Проверяем занятость…'
                : sellers.length === 0
                  ? 'В компании нет продажников — добавьте их в разделе «Команда».'
                  : free.length === 0
                    ? 'В это время все заняты. Выберите другой час.'
                    : `Свободны: ${free.length} из ${sellers.length}`}
            </p>
          </div>

          <Field
            label="Оплата за урок, ₸"
            name="amount"
            type="number"
            min={0}
            step={100}
            defaultValue={0}
            hint="Сколько клиент заплатил за пробный урок"
          />

          <FormMessage error={state.error} />
          <SubmitButton label="Записать на урок" pendingLabel="Записываем…" />
        </form>
      )}
    </Modal>
  );
}

type Seller = { id: string; fullName: string; busy: boolean };

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
