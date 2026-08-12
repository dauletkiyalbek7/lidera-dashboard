'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { IconClose } from '@/components/ui/icons';

/**
 * Модальное окно для форм кабинета.
 * Закрывается по Escape и клику вне окна, возвращает фокус и блокирует
 * прокрутку страницы, пока открыто.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Фокус на первое поле формы — чтобы можно было сразу печатать.
    panelRef.current
      ?.querySelector<HTMLElement>('input, select, textarea, button')
      ?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Закрыть"
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-card border border-line-strong bg-surface shadow-2xl shadow-black/60 sm:rounded-card"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="Закрыть окно"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

/** Выпадающий список в оформлении форм кабинета. */
export function Select({
  label,
  name,
  options,
  defaultValue,
  hint,
  required,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-[13px] font-medium text-ink-soft">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink transition-colors focus:border-lime/50 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1.5 text-[12px] text-faint">{hint}</p> : null}
    </div>
  );
}
