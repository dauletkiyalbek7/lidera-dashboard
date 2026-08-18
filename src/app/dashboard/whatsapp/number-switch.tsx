'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { setNumberStatus } from './actions';

/**
 * Включение и отключение приёма.
 *
 * Отключённый номер не удаляется: к нему привязаны переписки и заявки, и
 * вместе с ним ушла бы вся история обращений.
 */
export function NumberSwitch({
  numberId,
  status,
}: {
  numberId: string;
  status: 'connected' | 'disconnected' | 'error';
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = status === 'connected' ? 'disconnected' : 'connected';

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setNumberStatus(numberId, next);
            if (result.error) setError(result.error);
          })
        }
      >
        {pending ? '…' : next === 'connected' ? 'Включить' : 'Отключить'}
      </Button>
      {error ? <span className="text-[12px] text-negative">{error}</span> : null}
    </div>
  );
}
