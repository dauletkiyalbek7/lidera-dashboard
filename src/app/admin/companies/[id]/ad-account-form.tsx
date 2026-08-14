'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  attachMetaAccount,
  detachMetaAccount,
  type AdminState,
  type MetaAccountOption,
} from '@/app/admin/actions';
import { FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';

const selectClass =
  'mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink focus:border-lime/50 focus:outline-none';

/**
 * Выбор рекламного кабинета из тех, что видит токен платформы.
 *
 * Номер кабинета не набирают руками: список приходит из Meta, а занятые
 * кабинеты видно сразу — один кабинет может принадлежать только одной компании,
 * иначе расход попадёт в два отчёта.
 */
export function AdAccountForm({
  companyId,
  accounts,
  error,
}: {
  companyId: string;
  accounts: MetaAccountOption[];
  error?: string;
}) {
  const [state, formAction] = useActionState(attachMetaAccount, {} as AdminState);
  const free = accounts.filter((account) => !account.takenBy);
  const [selected, setSelected] = useState(free[0]?.accountId ?? '');

  if (error) {
    return (
      <div className="px-5 py-5 sm:px-6">
        <FormMessage error={error} />
      </div>
    );
  }

  const current = accounts.find((account) => account.accountId === selected);

  return (
    <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
      <input type="hidden" name="companyId" value={companyId} />
      {/* Название сохраняем вместе с номером: оно видно в списке подключённых,
          даже если кабинет потом переименуют в Meta. */}
      <input type="hidden" name="accountName" value={current?.name ?? 'Рекламный кабинет'} />

      <div>
        <label htmlFor="accountId" className="block text-[13px] font-medium text-ink-soft">
          Рекламный кабинет Meta
        </label>
        <select
          id="accountId"
          name="accountId"
          className={selectClass}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {free.length === 0 ? (
            <option value="">Токену платформы не выдан ни один свободный кабинет</option>
          ) : null}
          {accounts.map((account) => (
            <option
              key={account.accountId}
              value={account.accountId}
              disabled={Boolean(account.takenBy)}
            >
              {account.name}
              {account.currency ? ` · ${account.currency}` : ''}
              {account.takenBy ? ` — занят: ${account.takenBy}` : ''}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
          После подключения платформа сразу заберёт последние 30 дней: кампании,
          креативы, расход и переписки. Дальше обновляется сама каждые два часа.
        </p>
      </div>

      <div>
        <label htmlFor="manualId" className="block text-[13px] font-medium text-ink-soft">
          Или номер кабинета вручную
        </label>
        <input
          id="manualId"
          name="manualId"
          inputMode="numeric"
          placeholder="act_1497735681197831"
          className={selectClass}
        />
        <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
          Нужно, когда кабинет выдан партнёрским доступом: в списке своих он не
          появляется, но по номеру читается. Платформа проверит доступ и скажет, чего
          не хватает.
        </p>
      </div>

      <FormMessage error={state.error} success={state.success} />

      <Submit label="Подключить и загрузить данные" />
    </form>
  );
}

/** Подключённые кабинеты компании с кнопкой отключения. */
export function AdAccountList({
  companyId,
  accounts,
}: {
  companyId: string;
  accounts: { id: string; name: string; accountId: string | null; currency: string | null; status: string }[];
}) {
  const [state, formAction] = useActionState(detachMetaAccount, {} as AdminState);

  if (accounts.length === 0) {
    return (
      <p className="px-5 pb-1 pt-4 text-[13.5px] text-muted sm:px-6">
        Рекламный кабинет ещё не подключён.
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-line">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-ink">{account.name}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-faint">
                act_{account.accountId ?? '—'}
                {account.currency ? ` · ${account.currency}` : ''}
              </p>
            </div>
            <form action={formAction}>
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="adAccountRowId" value={account.id} />
              <Button type="submit" variant="ghost" size="sm">
                Отключить
              </Button>
            </form>
          </li>
        ))}
      </ul>
      {state.error || state.success ? (
        <div className="px-5 pb-4 sm:px-6">
          <FormMessage error={state.error} success={state.success} />
        </div>
      ) : null}
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Подключаем…' : label}
    </Button>
  );
}
