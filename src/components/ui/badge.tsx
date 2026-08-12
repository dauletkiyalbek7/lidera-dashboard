import type { ReactNode } from 'react';

type Tone = 'neutral' | 'positive' | 'warning' | 'negative' | 'lime';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-soft border-line-strong',
  positive: 'bg-positive/12 text-positive border-positive/25',
  warning: 'bg-warning/12 text-warning border-warning/25',
  negative: 'bg-negative/12 text-negative border-negative/25',
  lime: 'bg-lime/12 text-lime border-lime/25',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium leading-none ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Точка-статус. Цвет никогда не единственный носитель смысла — рядом всегда текст. */
export function StatusDot({ tone = 'neutral' }: { tone?: Tone }) {
  const color: Record<Tone, string> = {
    neutral: 'bg-faint',
    positive: 'bg-positive',
    warning: 'bg-warning',
    negative: 'bg-negative',
    lime: 'bg-lime',
  };
  return <span className={`size-1.5 shrink-0 rounded-full ${color[tone]}`} />;
}
