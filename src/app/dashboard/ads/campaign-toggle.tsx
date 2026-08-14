'use client';

import { useState, useTransition } from 'react';

import { setCampaignCounted } from './actions';

/**
 * Переключатель «учитывать кампанию в отчётах».
 *
 * В одном кабинете рядом идут курсы и наём. Выключенная кампания остаётся
 * видимой в таблице — но её расход и лиды не попадают в итоги и в цену лида.
 */
export function CampaignToggle({
  campaignId,
  counted,
  disabled,
}: {
  campaignId: string;
  counted: boolean;
  disabled: boolean;
}) {
  const [on, setOn] = useState(counted);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Учитывать кампанию в отчётах"
      disabled={disabled || pending}
      onClick={() => {
        const next = !on;
        setOn(next);
        startTransition(async () => {
          const result = await setCampaignCounted(campaignId, next);
          if (result.error) setOn(!next);
        });
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
        on ? 'border-lime/40 bg-lime/25' : 'border-line bg-surface-2'
      }`}
    >
      <span
        className={`size-4 rounded-full transition-transform ${
          on ? 'translate-x-6 bg-lime' : 'translate-x-1 bg-faint'
        }`}
      />
    </button>
  );
}
