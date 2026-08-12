'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  PRESETS,
  parseIsoDate,
  rangeLabel,
  toIsoDate,
  type DateRange,
  type PresetKey,
} from '@/lib/period';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Выбор периода: пресеты слева, календарь справа.
 * Диапазон выбирается двумя кликами — первый ставит начало, второй конец.
 * Выбранное уезжает в адрес страницы (?from=&to=), поэтому им можно поделиться.
 */
export function DateRangePicker({ range }: { range: DateRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(parseIsoDate(range.to)));

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const apply = (from: string, to: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('period');
    params.set('from', from);
    params.set('to', to);
    setOpen(false);
    setDraftFrom(null);
    setHovered(null);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  };

  const applyPreset = (preset: PresetKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('from');
    params.delete('to');
    params.set('period', preset);
    setOpen(false);
    setDraftFrom(null);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  };

  const onDayClick = (day: string) => {
    if (!draftFrom) {
      setDraftFrom(day);
      return;
    }
    const [from, to] = draftFrom <= day ? [draftFrom, day] : [day, draftFrom];
    apply(from, to);
  };

  // Пока выбрана только первая дата — подсвечиваем диапазон под курсором.
  const previewFrom = draftFrom ?? range.from;
  const previewTo = draftFrom ? (hovered ?? draftFrom) : range.to;
  const [highlightFrom, highlightTo] =
    previewFrom <= previewTo ? [previewFrom, previewTo] : [previewTo, previewFrom];

  const months = useMemo(
    () => [monthCursor, addMonths(monthCursor, 1)],
    [monthCursor],
  );

  const today = toIsoDate(new Date());

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex h-10 items-center gap-2.5 rounded-control border border-line bg-surface px-3.5 text-[13.5px] text-ink transition-colors hover:border-line-strong ${
          pending ? 'opacity-60' : ''
        }`}
      >
        <CalendarIcon />
        <span className="tabular whitespace-nowrap">{range.label}</span>
        <ChevronIcon open={open} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Выбор периода"
          className="absolute right-0 z-50 mt-2 w-[min(92vw,660px)] overflow-hidden rounded-card border border-line-strong bg-surface shadow-2xl shadow-black/60"
        >
          <div className="flex flex-col sm:flex-row">
            <ul className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-[190px] sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
              {PRESETS.map((preset) => (
                <li key={preset.key}>
                  <button
                    type="button"
                    onClick={() => applyPreset(preset.key)}
                    className={`w-full whitespace-nowrap rounded-control px-3 py-2 text-left text-[13px] transition-colors ${
                      range.preset === preset.key
                        ? 'bg-lime/10 text-lime'
                        : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
                    }`}
                  >
                    {preset.label}
                  </button>
                </li>
              ))}
            </ul>

            <div className="min-w-0 flex-1 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMonthCursor(addMonths(monthCursor, -1))}
                  className="flex size-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  aria-label="Предыдущий месяц"
                >
                  <ArrowIcon direction="left" />
                </button>
                <p className="text-[13px] text-muted">
                  {draftFrom
                    ? 'Выберите вторую дату диапазона'
                    : 'Выберите начало диапазона'}
                </p>
                <button
                  type="button"
                  onClick={() => setMonthCursor(addMonths(monthCursor, 1))}
                  className="flex size-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  aria-label="Следующий месяц"
                >
                  <ArrowIcon direction="right" />
                </button>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                {months.map((month, index) => (
                  <MonthGrid
                    key={month.toISOString()}
                    month={month}
                    today={today}
                    highlightFrom={highlightFrom}
                    highlightTo={highlightTo}
                    onDayClick={onDayClick}
                    onDayHover={setHovered}
                    /* На мобильном показываем один месяц — второй только с sm */
                    className={index === 1 ? 'hidden sm:block' : ''}
                  />
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                <p className="tabular text-[12.5px] text-faint">
                  {draftFrom
                    ? `Начало: ${rangeLabel(draftFrom, draftFrom)}`
                    : `Сейчас: ${range.label}`}
                </p>
                {draftFrom ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraftFrom(null)}
                  >
                    Сбросить
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MonthGrid({
  month,
  today,
  highlightFrom,
  highlightTo,
  onDayClick,
  onDayHover,
  className = '',
}: {
  month: Date;
  today: string;
  highlightFrom: string;
  highlightTo: string;
  onDayClick: (day: string) => void;
  onDayHover: (day: string | null) => void;
  className?: string;
}) {
  const cells = useMemo(() => monthCells(month), [month]);
  const title = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(month);

  return (
    <div className={className}>
      <p className="mb-2 text-center text-[13px] font-medium capitalize text-ink">{title}</p>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="pb-1 text-center text-[11px] text-faint">
            {weekday}
          </span>
        ))}

        {cells.map((cell, index) => {
          if (!cell) return <span key={`empty-${index}`} />;

          const inRange = cell >= highlightFrom && cell <= highlightTo;
          const isStart = cell === highlightFrom;
          const isEnd = cell === highlightTo;
          const isFuture = cell > today;

          return (
            <button
              key={cell}
              type="button"
              disabled={isFuture}
              onClick={() => onDayClick(cell)}
              onMouseEnter={() => onDayHover(cell)}
              onMouseLeave={() => onDayHover(null)}
              aria-pressed={inRange}
              className={[
                'tabular h-8 text-[12.5px] transition-colors',
                isFuture ? 'cursor-not-allowed text-faint/40' : 'hover:bg-surface-3',
                inRange && !isStart && !isEnd ? 'bg-lime/10 text-ink' : '',
                isStart || isEnd ? 'bg-lime font-medium text-on-lime' : '',
                isStart && isEnd ? 'rounded-control' : '',
                isStart && !isEnd ? 'rounded-l-control' : '',
                isEnd && !isStart ? 'rounded-r-control' : '',
                !inRange && !isFuture ? 'text-ink-soft' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {Number(cell.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Ячейки месяца: пустые места до первого понедельника + все дни. */
function monthCells(month: Date): (string | null)[] {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toIsoDate(new Date(month.getFullYear(), month.getMonth(), day)));
  }
  return cells;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3.5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} />
    </svg>
  );
}
