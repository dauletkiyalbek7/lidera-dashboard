'use client';

import { useState, useTransition } from 'react';

import { IconCheck } from '@/components/ui/icons';
import { switchCompany } from '@/app/dashboard/switch-company/actions';

export type SwitchableCompany = { id: string; name: string };

/**
 * Переключатель проектов в шапке меню.
 *
 * Показывается только тем, у кого проектов больше одного: у остальных это
 * была бы кнопка без выбора. Название проекта остаётся на прежнем месте —
 * при одном проекте шапка выглядит ровно так же, как раньше.
 */
export function CompanySwitcher({
  companies,
  currentId,
  hint,
}: {
  companies: SwitchableCompany[];
  currentId: string;
  hint: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const current = companies.find((company) => company.id === currentId);

  const choose = (companyId: string) => {
    setOpen(false);
    if (companyId === currentId) return;
    startTransition(async () => {
      await switchCompany(companyId);
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-control text-left disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">
            {current?.name ?? '—'}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-faint">
            {pending ? 'Переключаем…' : hint}
          </span>
        </span>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="M6 8l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <>
          {/* Клик мимо списка закрывает его — иначе он остаётся висеть. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <ul className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-panel border border-line bg-surface shadow-lg">
            {companies.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  onClick={() => choose(company.id)}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13.5px] text-ink-soft transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate">{company.name}</span>
                  {company.id === currentId ? (
                    <IconCheck className="size-4 shrink-0 text-lime" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
