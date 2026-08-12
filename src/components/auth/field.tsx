import type { ComponentProps } from 'react';

export function Field({
  label,
  name,
  hint,
  ...props
}: ComponentProps<'input'> & { label: string; name: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={name} className="block text-[13px] font-medium text-ink-soft">
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3.5 text-[14.5px] text-ink placeholder:text-faint transition-colors focus:border-lime/50 focus:outline-none"
        {...props}
      />
      {hint ? <p className="mt-1.5 text-[12px] text-faint">{hint}</p> : null}
    </div>
  );
}

export function FormMessage({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  if (!error && !success) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className={`rounded-control border px-3.5 py-2.5 text-[13px] leading-relaxed ${
        error
          ? 'border-negative/30 bg-negative/10 text-negative'
          : 'border-positive/30 bg-positive/10 text-positive'
      }`}
    >
      {error ?? success}
    </p>
  );
}
