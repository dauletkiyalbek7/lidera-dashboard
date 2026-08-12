import type { ReactNode } from 'react';

/**
 * KPI-плитка: подпись, крупное значение, необязательный контекст.
 * Значение — единственный «громкий» элемент, всё остальное приглушено.
 */
export function StatTile({
  label,
  value,
  hint,
  accent = false,
  icon,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  accent?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div
      className={`rounded-panel border p-4 sm:p-5 ${
        accent ? 'border-lime/30 bg-lime/[0.06]' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        {icon ? <span className="text-faint">{icon}</span> : null}
      </div>
      <p
        className={`tabular mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px] ${
          accent ? 'text-lime' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {hint ? <div className="mt-2 text-[12.5px] text-faint">{hint}</div> : null}
    </div>
  );
}
