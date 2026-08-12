'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { PERIODS, type PeriodKey } from '@/lib/period';

/** Переключатель периода. Один компонент на все разделы с метриками. */
export function PeriodTabs({ active }: { active: PeriodKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const select = (key: PeriodKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('period', key);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  };

  return (
    <div
      className={`inline-flex rounded-control border border-line bg-surface p-1 ${
        pending ? 'opacity-60' : ''
      }`}
      role="group"
      aria-label="Период"
    >
      {PERIODS.map((period) => (
        <button
          key={period.key}
          type="button"
          onClick={() => select(period.key)}
          aria-pressed={period.key === active}
          className={`rounded-[8px] px-3 py-1.5 text-[13px] transition-colors ${
            period.key === active
              ? 'bg-surface-3 text-ink'
              : 'text-muted hover:text-ink-soft'
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
