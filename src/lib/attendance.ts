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
