/**
 * Смены и посещаемость.
 *
 * Режим смены — свойство компании, а не платформы: офисный отдел продаж и
 * менеджеры на удалёнке работают по разным правилам, и оба варианта нормальные.
 */

export const SHIFT_MODE_ORDER = ['always', 'shift', 'geo'] as const;

export type ShiftMode = (typeof SHIFT_MODE_ORDER)[number];

export const SHIFT_MODE: Record<ShiftMode, { label: string; hint: string }> = {
  always: {
    label: 'Без смены',
    hint: 'Менеджеры получают лиды всегда — смену открывать не нужно',
  },
  shift: {
    label: 'По кнопке «Я на смене»',
    hint: 'Лиды идут только тем, кто отметился в боте. Место не проверяется — подходит для удалёнки',
  },
  geo: {
    label: 'По кнопке и геолокации',
    hint: 'Смену можно открыть только рядом с офисом: бот попросит отправить геолокацию',
  },
};

export function isShiftMode(value: string): value is ShiftMode {
  return (SHIFT_MODE_ORDER as readonly string[]).includes(value);
}

/**
 * Справочник статусов посещаемости. Компания включает нужные, но берёт их
 * отсюда — иначе отчёты по разным компаниям станет невозможно сравнивать.
 */
export const ATTENDANCE_STATUS_ORDER = [
  'on_shift',
  'late',
  'absent',
  'sick',
  'vacation',
  'day_off',
  'remote',
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUS_ORDER)[number];

type Tone = 'neutral' | 'positive' | 'warning' | 'negative' | 'lime';

export const ATTENDANCE_STATUS: Record<
  AttendanceStatus,
  { label: string; tone: Tone; hint: string; worked: boolean }
> = {
  on_shift: {
    label: 'На смене',
    tone: 'positive',
    hint: 'Отметился вовремя',
    worked: true,
  },
  late: {
    label: 'Опоздал',
    tone: 'warning',
    hint: 'Открыл смену позже начала рабочего дня',
    worked: true,
  },
  absent: {
    label: 'Не вышел',
    tone: 'negative',
    hint: 'Рабочий день, но смены не было',
    worked: false,
  },
  sick: { label: 'Больничный', tone: 'neutral', hint: 'По болезни', worked: false },
  vacation: { label: 'Отпуск', tone: 'neutral', hint: 'Плановый отпуск', worked: false },
  day_off: { label: 'Выходной', tone: 'neutral', hint: 'Нерабочий день', worked: false },
  remote: {
    label: 'Удалённо',
    tone: 'lime',
    hint: 'Работает не из офиса',
    worked: true,
  },
};

/** Минимальный набор: его хватает большинству компаний. */
export const DEFAULT_ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'on_shift',
  'late',
  'absent',
];

/** Эти три ставит сама система по сменам — выключить их нельзя. */
export const AUTOMATIC_ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'on_shift',
  'late',
  'absent',
];

export function isAttendanceStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUS_ORDER as readonly string[]).includes(value);
}

export function attendanceLabel(value: string): string {
  return isAttendanceStatus(value) ? ATTENDANCE_STATUS[value].label : value;
}

/** Статусы, которые директор может проставить руками в разделе «Посещение». */
export function manualStatusesFor(enabled: string[]): AttendanceStatus[] {
  return ATTENDANCE_STATUS_ORDER.filter(
    (status) => enabled.includes(status) && status !== 'on_shift' && status !== 'late',
  );
}

/**
 * Дни недели по ISO: 1 — понедельник, 7 — воскресенье.
 * Тот же порядок, что у Postgres и у `Intl`, — не нужно ничего пересчитывать.
 */
export const WEEKDAYS = [
  { value: 1, short: 'Пн', label: 'Понедельник' },
  { value: 2, short: 'Вт', label: 'Вторник' },
  { value: 3, short: 'Ср', label: 'Среда' },
  { value: 4, short: 'Чт', label: 'Четверг' },
  { value: 5, short: 'Пт', label: 'Пятница' },
  { value: 6, short: 'Сб', label: 'Суббота' },
  { value: 7, short: 'Вс', label: 'Воскресенье' },
] as const;

/** Готовые графики: ими закрываются почти все реальные отделы продаж. */
export const WORK_DAY_PRESETS = [
  { label: '5/2', hint: 'Пн–Пт', days: [1, 2, 3, 4, 5] },
  { label: '6/1', hint: 'Пн–Сб', days: [1, 2, 3, 4, 5, 6] },
  { label: '7/0', hint: 'без выходных', days: [1, 2, 3, 4, 5, 6, 7] },
];

/** Частые смены — чтобы не набирать время руками. */
export const WORK_TIME_PRESETS = [
  { start: '09:00', end: '18:00' },
  { start: '10:00', end: '19:00' },
  { start: '11:00', end: '20:00' },
  { start: '12:00', end: '21:00' },
];

export function isWeekday(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

/**
 * Рабочие дни приходят из формы набором галочек. Пустой набор — не «как
 * обычно», а нерабочая неделя, поэтому возвращаем null и показываем ошибку,
 * а не подставляем что-то молча.
 */
export function parseWorkDays(values: (string | number)[]): number[] | null {
  const days = Array.from(new Set(values.map(Number).filter(isWeekday))).sort(
    (a, b) => a - b,
  );
  return days.length === 0 ? null : days;
}

/** «Пн–Пт», «Каждый день», «Пн, Ср, Пт» — коротко и читаемо. */
export function formatWorkDays(days: number[]): string {
  const sorted = Array.from(new Set(days.filter(isWeekday))).sort((a, b) => a - b);
  if (sorted.length === 0) return 'дни не выбраны';
  if (sorted.length === 7) return 'Каждый день';

  const short = (value: number) => WEEKDAYS[value - 1].short;
  const solid = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);

  if (solid && sorted.length > 2) return `${short(sorted[0])}–${short(sorted[sorted.length - 1])}`;
  return sorted.map(short).join(', ');
}

/**
 * Длительность смены в минутах. Конец раньше начала — это ночная смена
 * через полночь, а не ошибка: у части компаний так и работают.
 */
export function shiftDurationMinutes(start: string, end: string): number {
  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  if (from === null || to === null) return 0;
  const diff = to - from;
  return diff > 0 ? diff : diff + 24 * 60;
}

export function minutesOfDay(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** «8 ч», «7 ч 30 мин», «45 мин». */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/** Короткая строка графика для таблиц и подсказок. */
export function formatSchedule(rules: {
  workDays: number[];
  workStartTime: string;
  workEndTime: string;
}): string {
  return `${formatWorkDays(rules.workDays)} · ${hhmm(rules.workStartTime)}–${hhmm(rules.workEndTime)}`;
}

export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** День недели по ISO в часовом поясе компании — опоздание считается по нему. */
export function weekdayInZone(date: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(short);
  return index === -1 ? 1 : index + 1;
}

/**
 * Действующие правила для конкретного сотрудника.
 *
 * Настройки компании — значение по умолчанию, личные поля их перекрывают.
 * Отдельная функция нужна, чтобы «наследовать» не приходилось повторять в боте,
 * в раздаче и в интерфейсе — три места разошлись бы при первой же правке.
 */
export type ShiftRules = {
  mode: ShiftMode;
  workStartTime: string;
  workEndTime: string;
  workDays: number[];
  lateGraceMinutes: number;
  /** Правило личное или досталось от компании — это видно в интерфейсе. */
  personal: boolean;
  /** Личный график (дни и часы) — отдельно от режима смены. */
  personalSchedule: boolean;
};

export type EmployeeShiftFields = {
  shift_mode: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  work_days: number[] | null;
  late_grace_minutes: number | null;
};

export type CompanyShiftFields = {
  shift_mode: string;
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  late_grace_minutes: number;
};

export function resolveShiftRules(
  employee: EmployeeShiftFields,
  company: CompanyShiftFields,
): ShiftRules {
  const mode = employee.shift_mode ?? company.shift_mode;
  const days = employee.work_days ?? company.work_days;

  const personalSchedule =
    employee.work_start_time !== null ||
    employee.work_end_time !== null ||
    employee.work_days !== null ||
    employee.late_grace_minutes !== null;

  return {
    mode: isShiftMode(mode) ? mode : 'shift',
    workStartTime: employee.work_start_time ?? company.work_start_time,
    workEndTime: employee.work_end_time ?? company.work_end_time,
    workDays: (days ?? []).filter(isWeekday),
    lateGraceMinutes: employee.late_grace_minutes ?? company.late_grace_minutes,
    personal: employee.shift_mode !== null || personalSchedule,
    personalSchedule,
  };
}
