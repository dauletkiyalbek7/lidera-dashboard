'use client';

import { useState, useTransition } from 'react';

import { updateTrialStatus } from '@/app/dashboard/actions';
import { TRIAL_STATUS } from '@/lib/labels';

const TRIAL_STATUS_OPTIONS = Object.entries(TRIAL_STATUS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

/**
 * Статус пробного меняется прямо в списке: «проведён» сразу попадает
 * в воронку и в аналитику креативов.
 */
export function TrialStatusSelect({
  trialId,
  status,
}: {
  trialId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = (next: string) => {
    setError(null);
    startTransition(async () => {
      const result = await updateTrialStatus(trialId, next);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div>
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
      {error ? <p className="mt-1 text-[11px] text-negative">{error}</p> : null}
    </div>
  );
}
