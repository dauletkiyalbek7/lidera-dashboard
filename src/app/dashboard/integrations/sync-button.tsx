'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { syncMetaNow, type SyncState } from './actions';

/** Ручная проверка связи с рекламным кабинетом — результат показываем текстом. */
export function SyncMetaButton({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SyncState>({});

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending || disabled}
          onClick={() => {
            setState({});
            startTransition(async () => setState(await syncMetaNow()));
          }}
        >
          {pending ? 'Обновляем…' : 'Обновить сейчас'}
        </Button>
      </div>

      {state.error || state.success ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 rounded-control border px-3 py-2 text-[12.5px] leading-relaxed ${
            state.error
              ? 'border-negative/30 bg-negative/10 text-negative'
              : 'border-positive/30 bg-positive/10 text-positive'
          }`}
        >
          {state.error ?? state.success}
        </p>
      ) : null}
    </div>
  );
}
