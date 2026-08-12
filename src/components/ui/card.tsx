import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  edge = false,
}: {
  children: ReactNode;
  className?: string;
  edge?: boolean;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-surface ${
        edge ? 'edge-top' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-1 text-[13px] text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  className = '',
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`max-w-2xl ${className}`}>
      {eyebrow ? (
        <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.22em] text-lime">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-balance text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-pretty text-[15px] leading-relaxed text-ink-soft sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}
