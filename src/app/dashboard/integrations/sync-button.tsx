'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { syncMetaNow, type SyncState } from './actions';

/**
 * Ручная проверка связи с рекламным кабинетом.
 *
 * Кнопка стоит в шапке раздела, рядом с диапазоном дат, поэтому сама она
 * ничего не растягивает: результат показываем всплывающей плашкой под ней,
 * а не в потоке — иначе строка шапки прыгает и съезжает.
 */
export function SyncMetaButton({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SyncState>({});

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        size="field"
        disabled={pending || disabled}
        onClick={() => {
          setState({});
          startTransition(async () => setState(await syncMetaNow()));
        }}
      >
        <IconRefresh className={`size-4 ${pending ? 'animate-spin' : ''}`} />
        {pending ? 'Обновляем…' : 'Обновить'}
      </Button>

      {state.error || state.success ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[80vw]">
          <p
            role="status"
            aria-live="polite"
            className={`rounded-control border px-3 py-2 text-[12.5px] leading-relaxed shadow-lg shadow-black/20 ${
              state.error
                ? 'border-negative/30 bg-negative/10 text-negative'
                : 'border-positive/30 bg-positive/10 text-positive'
            }`}
          >
            {state.error ?? state.success}
            <button
              type="button"
              onClick={() => setState({})}
              className="mt-1.5 block text-[11.5px] underline-offset-2 hover:underline"
            >
              Скрыть
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  );
}
