/**
 * Диапазон дат — общий для всех разделов кабинета.
 *
 * В URL живёт либо пресет (?period=30d), либо произвольный диапазон
 * (?from=2026-07-01&to=2026-07-31). Ссылку с любым из них можно переслать
 * коллеге — состояние страницы полностью описывается адресом.
 */

export type PresetKey =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | '90d'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month';

export type DateRange = {
  from: string;
  to: string;
  /** Ключ пресета или null, если диапазон выбран вручную. */
  preset: PresetKey | null;
  /** Подпись для заголовков: «за последние 30 дней», «за 1–31 июля». */
  label: string;
};

export const DEFAULT_PRESET: PresetKey = '30d';

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: '7d', label: 'Последние 7 дней' },
  { key: '30d', label: 'Последние 30 дней' },
  { key: '90d', label: 'Последние 90 дней' },
  { key: 'this_week', label: 'Эта неделя' },
  { key: 'last_week', label: 'Прошлая неделя' },
  { key: 'this_month', label: 'Этот месяц' },
  { key: 'last_month', label: 'Прошлый месяц' },
];

/** Дата в формате YYYY-MM-DD по локальному времени, а не по UTC. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const date = parseIsoDate(value);
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value;
}

/** Границы пресета относительно переданного «сегодня». */
export function presetRange(preset: PresetKey, today = new Date()): {
  from: string;
  to: string;
} {
  const start = startOfDay(today);

  const shiftDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };

  // Неделя считается с понедельника.
  const startOfWeek = (date: Date) => {
    const weekday = (date.getDay() + 6) % 7;
    return shiftDays(date, -weekday);
  };

  switch (preset) {
    case 'today':
      return { from: toIsoDate(start), to: toIsoDate(start) };
    case 'yesterday': {
      const yesterday = shiftDays(start, -1);
      return { from: toIsoDate(yesterday), to: toIsoDate(yesterday) };
    }
    case '7d':
      return { from: toIsoDate(shiftDays(start, -6)), to: toIsoDate(start) };
    case '90d':
      return { from: toIsoDate(shiftDays(start, -89)), to: toIsoDate(start) };
    case 'this_week':
      return { from: toIsoDate(startOfWeek(start)), to: toIsoDate(start) };
    case 'last_week': {
      const previous = shiftDays(startOfWeek(start), -7);
      return { from: toIsoDate(previous), to: toIsoDate(shiftDays(previous, 6)) };
    }
    case 'this_month':
      return {
        from: toIsoDate(new Date(start.getFullYear(), start.getMonth(), 1)),
        to: toIsoDate(start),
      };
    case 'last_month': {
      const first = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      const last = new Date(start.getFullYear(), start.getMonth(), 0);
      return { from: toIsoDate(first), to: toIsoDate(last) };
    }
    case '30d':
    default:
      return { from: toIsoDate(shiftDays(start, -29)), to: toIsoDate(start) };
  }
}

/**
 * Разбор параметров страницы. Произвольный диапазон имеет приоритет над
 * пресетом; некорректные значения молча заменяются диапазоном по умолчанию.
 */
export function resolveRange(params: {
  period?: string;
  from?: string;
  to?: string;
}): DateRange {
  if (isValidIsoDate(params.from) && isValidIsoDate(params.to)) {
    const [from, to] =
      params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
    return { from, to, preset: matchPreset(from, to), label: rangeLabel(from, to) };
  }

  const preset = PRESETS.find((item) => item.key === params.period)?.key ?? DEFAULT_PRESET;
  const { from, to } = presetRange(preset);
  return { from, to, preset, label: rangeLabel(from, to) };
}

/** Если ручной диапазон совпал с пресетом — подсвечиваем этот пресет. */
function matchPreset(from: string, to: string): PresetKey | null {
  for (const { key } of PRESETS) {
    const range = presetRange(key);
    if (range.from === from && range.to === to) return key;
  }
  return null;
}

export function rangeLabel(from: string, to: string): string {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);

  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric' });
  const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  const full = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  if (from === to) return full.format(start);

  const sameYear = start.getFullYear() === end.getFullYear();
  if (!sameYear) return `${full.format(start)} — ${full.format(end)}`;

  const sameMonth = start.getMonth() === end.getMonth();
  const left = sameMonth ? day.format(start) : dayMonth.format(start);
  return `${left} — ${full.format(end)}`;
}

/** Сколько дней в диапазоне включительно. */
export function rangeLength(from: string, to: string): number {
  const days = eachDay(from, to);
  return days.length;
}

/** Все даты диапазона — чтобы в графике не было пропущенных дней. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = parseIsoDate(from);
  const end = parseIsoDate(to);

  while (cursor <= end) {
    days.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
