import { DEFAULT_TIME_ZONE } from '@/lib/period';

/**
 * Касания лида — замена отъёму заявки.
 *
 * Лид остаётся у того менеджера, кому достался: второй звонок с другого номера
 * выглядит для человека как спам, а менеджер, у которого отбирают заявки,
 * перестаёт их дожимать. Поэтому не отвечает — не повод передать, а повод
 * запланировать следующую попытку.
 *
 * Время менеджер выбирает сам одной кнопкой: «через час», «вечером»,
 * «завтра». Считается оно в часовом поясе компании — «вечер» у клиента и на
 * сервере в Лондоне это разные вещи.
 *
 * Файл без 'server-only': пресеты нужны и кнопкам в кабинете, и боту.
 */

export type TouchPresetKey =
  | 'in_1h'
  | 'in_3h'
  | 'evening'
  | 'tomorrow'
  | 'in_2d'
  | 'in_week';

type TouchPreset = {
  key: TouchPresetKey;
  label: string;
  /** Короткая подпись для кнопки в чате — там мало места. */
  short: string;
  resolve: (now: Date, timeZone: string) => Date;
};

const HOUR = 60 * 60 * 1000;

/** Вечерний звонок — в 19:00 по месту компании, утренний — в 10:00. */
const EVENING_HOUR = 19;
const MORNING_HOUR = 10;

export const TOUCH_PRESETS: TouchPreset[] = [
  {
    key: 'in_1h',
    label: 'Через час',
    short: '⏱ Через час',
    resolve: (now) => new Date(now.getTime() + HOUR),
  },
  {
    key: 'in_3h',
    label: 'Через 3 часа',
    short: '⏱ Через 3 ч',
    resolve: (now) => new Date(now.getTime() + 3 * HOUR),
  },
  {
    key: 'evening',
    label: 'Сегодня вечером',
    short: '🌆 Вечером',
    // Если вечер уже наступил, обещание «вечером» переносится на завтра:
    // напоминание в прошлом не сработает никогда.
    resolve: (now, timeZone) => {
      const today = atLocalHour(now, EVENING_HOUR, timeZone);
      return today.getTime() > now.getTime() + 15 * 60 * 1000
        ? today
        : atLocalHour(addDays(now, 1), EVENING_HOUR, timeZone);
    },
  },
  {
    key: 'tomorrow',
    label: 'Завтра утром',
    short: '🌅 Завтра',
    resolve: (now, timeZone) => atLocalHour(addDays(now, 1), MORNING_HOUR, timeZone),
  },
  {
    key: 'in_2d',
    label: 'Через 2 дня',
    short: '📅 Через 2 дня',
    resolve: (now, timeZone) => atLocalHour(addDays(now, 2), MORNING_HOUR, timeZone),
  },
  {
    key: 'in_week',
    label: 'Через неделю',
    short: '📅 Через неделю',
    resolve: (now, timeZone) => atLocalHour(addDays(now, 7), MORNING_HOUR, timeZone),
  },
];

export function isTouchPreset(value: string): value is TouchPresetKey {
  return TOUCH_PRESETS.some((preset) => preset.key === value);
}

export function touchPreset(key: TouchPresetKey): TouchPreset {
  const found = TOUCH_PRESETS.find((preset) => preset.key === key);
  if (!found) throw new Error(`Неизвестный срок касания: ${key}`);
  return found;
}

/** Во сколько напомнить, если менеджер выбрал этот срок. */
export function resolveTouchTime(
  key: TouchPresetKey,
  timeZone: string = DEFAULT_TIME_ZONE,
  now = new Date(),
): Date {
  return touchPreset(key).resolve(now, timeZone);
}

// -----------------------------------------------------------------------------
// Время в часовом поясе компании
// -----------------------------------------------------------------------------

/**
 * Момент, когда в поясе `timeZone` наступит указанный час того же дня.
 *
 * Считается через смещение пояса: берём разницу между местным временем и UTC
 * в этот момент и переносим её на нужный час. Для поясов без перехода на
 * летнее время (а это все, где мы работаем) этого достаточно.
 */
function atLocalHour(base: Date, hour: number, timeZone: string): Date {
  const offset = zoneOffsetMinutes(base, timeZone);
  const local = new Date(base.getTime() + offset * 60000);
  local.setUTCHours(hour, 0, 0, 0);
  return new Date(local.getTime() - offset * 60000);
}

/**
 * Момент, когда в поясе компании наступит указанные дата и время.
 * Нужен записи на урок: менеджер выбирает «завтра в 18:00» по местному,
 * а хранить это надо абсолютным временем.
 */
export function instantInZone(
  isoDate: string,
  hhmm: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !/^\d{2}:\d{2}$/.test(hhmm)) return null;

  const [hours, minutes] = hhmm.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;

  // Первое приближение — как будто пояс совпадает с UTC, затем поправка на
  // его смещение именно в эту дату.
  const naive = new Date(`${isoDate}T${hhmm}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;

  const offset = zoneOffsetMinutes(naive, timeZone);
  return new Date(naive.getTime() - offset * 60000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * HOUR);
}

/** На сколько минут местное время опережает UTC в этот момент. */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
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

// -----------------------------------------------------------------------------
// Подписи
// -----------------------------------------------------------------------------

/** «через 20 минут», «через 3 часа», «завтра» — как это скажет человек. */
export function untilLabel(target: Date, now = new Date()): string {
  const minutes = Math.round((target.getTime() - now.getTime()) / 60000);

  if (minutes <= 0) return 'уже пора';
  if (minutes < 60) return `через ${minutes} мин`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `через ${hours} ${plural(hours, 'час', 'часа', 'часов')}`;

  const days = Math.round(hours / 24);
  return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

/** Просрочено ли обещание перезвонить. */
export function isOverdue(remindAt: string | null, now = new Date()): boolean {
  return remindAt !== null && new Date(remindAt).getTime() < now.getTime();
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
