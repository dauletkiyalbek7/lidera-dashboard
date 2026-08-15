'use client';

import { useState, useTransition } from 'react';

import { resendPurchase, type CapiState } from './actions';
import { Button } from '@/components/ui/button';
import { LEAD_QUALITY, isLeadQuality } from '@/lib/lead-quality';

/**
 * Очередь на отправку в Meta.
 *
 * Отправляет таргетолог и только вручную: событие о покупке учит алгоритм
 * искать похожих людей, поэтому случайного покупателя отправлять вредно —
 * реклама пойдёт за такими же. Оценку ставит продажник, решение принимает
 * таргетолог.
 */
export function PendingSend({
  saleId,
  quality,
}: {
  saleId: string;
  quality: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CapiState | null>(null);

  const send = () => {
    setState(null);
    startTransition(async () => setState(await resendPurchase(saleId)));
  };

  if (state?.success) {
    return <span className="text-[12.5px] text-lime">✓ отправлено</span>;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {state?.error ? (
        <span className="max-w-[220px] text-right text-[11.5px] text-negative">
          {state.error}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant={quality === 'cold' ? 'ghost' : 'secondary'}
        onClick={send}
        disabled={pending}
      >
        {pending ? 'Отправляем…' : 'Отправить в Meta'}
      </Button>
    </div>
  );
}

/** Крупная однозначная отметка: её читают взглядом, а не вчитываясь. */
export function QualityMark({ quality }: { quality: string | null }) {
  if (!quality || !isLeadQuality(quality)) {
    return <span className="text-[12.5px] text-faint">не оценён</span>;
  }

  const meta = LEAD_QUALITY[quality];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium ${
        quality === 'hot'
          ? 'bg-lime/15 text-lime-strong'
          : 'bg-surface-2 text-ink-soft'
      }`}
      title={meta.hint}
    >
      <span className="text-[14px] leading-none">{meta.icon}</span>
      {meta.label}
    </span>
  );
}
