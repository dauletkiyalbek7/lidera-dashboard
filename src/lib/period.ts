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

/**
 * По умолчанию — последние семь полных дней.
 *
 * Сегодняшний день в них не входит намеренно: он ещё идёт, расход и заявки
 * добираются весь вечер, и любая средняя по нему занижена. Неполный день в
 * отчёте выглядит как провал, которого не было.
 */
export const DEFAULT_PRESET: PresetKey = '7d';

/** Часовой пояс по умолчанию: платформа работает в Казахстане. */
export const DEFAULT_TIME_ZONE = 'Asia/Almaty';

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

/**
 * Сегодняшняя дата в часовом поясе компании.
 *
 * Сервер живёт по UTC, а Алматы на пять часов впереди: с полуночи до пяти утра
 * «сегодня» по-серверному — это ещё вчерашний день. Для отчётов день должен
 * начинаться тогда же, когда он начинается у людей в офисе.
 */
export function zonedIsoDate(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  try {
    // en-CA форматирует дату как YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    // Неизвестный пояс в настройках не должен ронять страницу.
    return toIsoDate(date);
  }
}

/** «Сегодня» компании как Date — от него считаются все пресеты. */
export function todayInZone(timeZone?: string): Date {
  return parseIsoDate(zonedIsoDate(new Date(), timeZone ?? DEFAULT_TIME_ZONE));
}

/**
 * Границы диапазона как абсолютное время.
 *
 * Даты в фильтре — местные: «15 августа» это день, который прожили в офисе.
 * А `created_at` хранится в UTC, и Алматы опережает его на пять часов. Если
 * сравнивать местную дату с UTC напрямую, заявки с полуночи до пяти утра
 * уезжают во вчера: за 15 августа их видно не будет, зато они появятся в 14-м.
 *
 * Правая граница — начало следующего дня, и сравнивать с ней надо строгим `<`.
 * Так в диапазон попадает и последняя секунда дня, и её доли.
 */
export function zonedDayWindow(
  from: string,
  to: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): { startsAt: string; endsBefore: string } {
  const start = instantInZone(from, '00:00', timeZone) ?? new Date(`${from}T00:00:00Z`);

  const nextDay = parseIsoDate(to);
  nextDay.setDate(nextDay.getDate() + 1);
  const dayAfter = toIsoDate(nextDay);
  const end = instantInZone(dayAfter, '00:00', timeZone) ?? new Date(`${dayAfter}T00:00:00Z`);

  return { startsAt: start.toISOString(), endsBefore: end.toISOString() };
}

/**
 * Момент, когда в поясе компании наступят указанные дата и время.
 * Нужен и записи на урок («завтра в 18:00» по местному, а хранить надо
 * абсолютным временем), и границам отчётного дня.
 */
export function instantInZone(
  isoDate: string,
  hhmm: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date | null {
  if (!ISO_DATE.test(isoDate) || !/^\d{2}:\d{2}$/.test(hhmm)) return null;

  const [hours, minutes] = hhmm.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;

  // Первое приближение — как будто пояс совпадает с UTC, затем поправка на
  // его смещение именно в эту дату.
  const naive = new Date(`${isoDate}T${hhmm}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;

  const offset = zoneOffsetMinutes(naive, timeZone);
  return new Date(naive.getTime() - offset * 60000);
}

/** На сколько минут местное время опережает UTC в этот момент. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);

    const value = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');

    // 24 часа Intl отдаёт как «24:00» в полночь — приводим к нулю.
    const hour = value('hour') % 24;

    const asUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      hour,
      value('minute'),
      value('second'),
    );

    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    // Неизвестный пояс — считаем по UTC, это лучше падения.
    return 0;
  }
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
    // «Последние N дней» — это N полных дней, до вчерашнего включительно.
    // Сегодняшний идёт отдельным пресетом: смешивать законченный период с
    // недожитым днём значит портить все средние в нём.
    case '7d':
      return { from: toIsoDate(shiftDays(start, -7)), to: toIsoDate(shiftDays(start, -1)) };
    case '90d':
      return { from: toIsoDate(shiftDays(start, -90)), to: toIsoDate(shiftDays(start, -1)) };
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
      return { from: toIsoDate(shiftDays(start, -30)), to: toIsoDate(shiftDays(start, -1)) };
  }
}

/**
 * Разбор параметров страницы. Произвольный диапазон имеет приоритет над
 * пресетом; некорректные значения молча заменяются диапазоном по умолчанию.
 */
export function resolveRange(
  params: {
    period?: string;
    from?: string;
    to?: string;
  },
  timeZone?: string,
): DateRange {
  const today = todayInZone(timeZone);

  if (isValidIsoDate(params.from) && isValidIsoDate(params.to)) {
    const [from, to] =
      params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
    return { from, to, preset: matchPreset(from, to, today), label: rangeLabel(from, to) };
  }

  const preset = PRESETS.find((item) => item.key === params.period)?.key ?? DEFAULT_PRESET;
  const { from, to } = presetRange(preset, today);
  return { from, to, preset, label: rangeLabel(from, to) };
}

/** Если ручной диапазон совпал с пресетом — подсвечиваем этот пресет. */
function matchPreset(from: string, to: string, today: Date): PresetKey | null {
  for (const { key } of PRESETS) {
    const range = presetRange(key, today);
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
