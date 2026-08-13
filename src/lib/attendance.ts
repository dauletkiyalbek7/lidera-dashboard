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
 * Действующие правила для конкретного сотрудника.
 *
 * Настройки компании — значение по умолчанию, личные поля их перекрывают.
 * Отдельная функция нужна, чтобы «наследовать» не приходилось повторять в боте,
 * в раздаче и в интерфейсе — три места разошлись бы при первой же правке.
 */
export type ShiftRules = {
  mode: ShiftMode;
  workStartTime: string;
  lateGraceMinutes: number;
  /** Правило личное или досталось от компании — это видно в интерфейсе. */
  personal: boolean;
};

export function resolveShiftRules(
  employee: {
    shift_mode: string | null;
    work_start_time: string | null;
    late_grace_minutes: number | null;
  },
  company: {
    shift_mode: string;
    work_start_time: string;
    late_grace_minutes: number;
  },
): ShiftRules {
  const mode = employee.shift_mode ?? company.shift_mode;

  return {
    mode: isShiftMode(mode) ? mode : 'shift',
    workStartTime: employee.work_start_time ?? company.work_start_time,
    lateGraceMinutes: employee.late_grace_minutes ?? company.late_grace_minutes,
    personal:
      employee.shift_mode !== null ||
      employee.work_start_time !== null ||
      employee.late_grace_minutes !== null,
  };
}
