/**
 * Роли сотрудников компании.
 *
 * Терминология клиента:
 *   РОП        — руководитель отдела продаж, следит за командой;
 *   Менеджер   — обрабатывает лиды; в воронке с пробными — записывает на пробное;
 *   Продажник  — проводит пробное и закрывает продажу курса.
 *
 * Продажник имеет смысл только там, где есть пробные занятия: в товарном
 * бизнесе продажу закрывает тот же менеджер, который принял лид.
 */

import type { FunnelType } from '@/lib/metrics';

export const EMPLOYEE_ROLE_ORDER = ['rop', 'manager', 'salesperson', 'targetolog'] as const;

export type EmployeeRole = (typeof EMPLOYEE_ROLE_ORDER)[number];

export const EMPLOYEE_ROLE: Record<
  EmployeeRole,
  { label: string; short: string; hint: string; onlyTrialFunnel?: true }
> = {
  rop: {
    label: 'РОП',
    short: 'РОП',
    hint: 'Руководитель отдела продаж: следит за командой и показателями',
  },
  manager: {
    label: 'Менеджер',
    short: 'Менеджер',
    hint: 'Принимает лиды, дозванивается и ведёт их по воронке',
  },
  salesperson: {
    label: 'Продажник',
    short: 'Продажник',
    hint: 'Проводит пробное занятие и закрывает продажу',
    onlyTrialFunnel: true,
  },
  targetolog: {
    label: 'Таргетолог',
    short: 'Таргет',
    hint: 'Ведёт рекламу и решает, какие покупки отправлять в рекламный кабинет',
  },
};

/** Кому открыт раздел CAPI: отправку событий доверяем только таргетологу. */
export function sendsCapi(role: EmployeeRole): boolean {
  return role === 'targetolog';
}

export function isEmployeeRole(value: string): value is EmployeeRole {
  return value in EMPLOYEE_ROLE;
}

export function employeeRoleLabel(value: string): string {
  return isEmployeeRole(value) ? EMPLOYEE_ROLE[value].label : value;
}

/** Роли, доступные компании: без пробных занятий продажник не нужен. */
export function employeeRolesFor(funnelType: FunnelType): EmployeeRole[] {
  return EMPLOYEE_ROLE_ORDER.filter(
    (role) => funnelType === 'trial' || !EMPLOYEE_ROLE[role].onlyTrialFunnel,
  );
}

/**
 * Кем распоряжается руководитель отдела продаж.
 *
 * Своими: менеджерами и продажниками. Ни второго РОПа, ни таргетолога он не
 * заводит и не увольняет — иначе руководитель отдела за одно нажатие
 * становился бы руководителем компании. У директора ограничений нет, поэтому
 * его роль здесь — null.
 *
 * То же правило стоит в политиках базы; здесь оно живёт ради интерфейса и
 * понятных сообщений об отказе.
 */
const SUBORDINATE_ROLES: EmployeeRole[] = ['manager', 'salesperson'];

export function managesRole(actorRole: string | null, role: string): boolean {
  if (actorRole === null) return true;
  return SUBORDINATE_ROLES.includes(role as EmployeeRole);
}

/** Роли, которые актор вправе завести в этой компании. */
export function rolesManagedBy(
  actorRole: string | null,
  funnelType: FunnelType,
): EmployeeRole[] {
  return employeeRolesFor(funnelType).filter((role) => managesRole(actorRole, role));
}

/**
 * Кому раздаются лиды. Продажник подключается на шаге пробного,
 * а РОП руководит — входящий поток на них не идёт.
 */
export function takesLeads(role: EmployeeRole): boolean {
  return role === 'manager';
}
