'use client';

import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { navFor, type NavItem } from '@/components/app/nav-config';
import { EMPLOYEE_ROLE, employeeRolesFor, type EmployeeRole } from '@/lib/employee-role';
import type { FunnelType } from '@/lib/metrics';

/**
 * Кто какой раздел видит.
 *
 * Таблица не хранится отдельно и ничего не настраивает: она строится из тех же
 * правил, по которым собирается боковое меню. Отдельный справочник разошёлся бы
 * с жизнью в первый же день — и получилась бы страница, которая уверенно врёт.
 *
 * Доступ к самим данным держат политики базы. Здесь видно только, кому раздел
 * открыт и в каком объёме.
 */

/** Что именно человек видит внутри раздела, если не всё. */
const SCOPE: Record<string, Partial<Record<EmployeeRole | 'director', string>>> = {
  '/dashboard/leads': {
    manager: 'свои заявки',
    salesperson: 'клиенты своих уроков',
    rop: 'весь отдел',
  },
  '/dashboard/inbox': { manager: 'свои переписки', rop: 'весь отдел' },
  '/dashboard/trials': {
    manager: 'что продал сам',
    salesperson: 'свои занятия',
    rop: 'весь отдел',
  },
  '/dashboard/sales': {
    manager: 'свои чеки',
    salesperson: 'свои чеки',
    rop: 'весь отдел',
  },
  '/dashboard/team': { rop: 'свой отдел' },
  '/dashboard/returns': { rop: 'оформляет возвраты' },
  '/dashboard/reports': { rop: 'свой отдел' },
};

type Column = { key: EmployeeRole | 'director'; label: string };

export function AccessMatrix({
  funnelType,
  trialTerm,
}: {
  funnelType: FunnelType;
  trialTerm: string;
}) {
  const roles: Column[] = [
    { key: 'director', label: 'Директор' },
    ...employeeRolesFor(funnelType).map((role) => ({
      key: role,
      label: EMPLOYEE_ROLE[role].short,
    })),
  ];

  // Меню директора — полный список разделов платформы: у него открыто всё.
  const groups = navFor('company', funnelType, false, null, trialTerm);

  // Для каждой роли собираем её собственное меню и запоминаем адреса: так
  // «видит» и «не видит» берутся ровно оттуда же, откуда берёт интерфейс.
  const seenBy = new Map<string, Set<string>>();
  for (const column of roles) {
    const menu =
      column.key === 'director'
        ? groups
        : navFor('company', funnelType, true, column.key, trialTerm);

    seenBy.set(
      column.key,
      new Set(menu.flatMap((group) => group.items.map((item: NavItem) => item.href))),
    );
  }

  const columns: TableColumn[] = [
    { key: 'section', label: 'Раздел' },
    ...roles.map((role) => ({ key: role.key, label: role.label, align: 'right' as const })),
  ];

  return (
    <TableShell columns={columns} minWidth={{ base: 460, md: 720 }}>
      {groups.map((group) => (
        <GroupRows key={group.title} group={group} roles={roles} seenBy={seenBy} />
      ))}
    </TableShell>
  );
}

function GroupRows({
  group,
  roles,
  seenBy,
}: {
  group: { title: string; items: NavItem[] };
  roles: Column[];
  seenBy: Map<string, Set<string>>;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={roles.length + 1}
          className="border-b border-line bg-surface-2/50 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint"
        >
          {group.title}
        </td>
      </tr>
      {group.items.map((item) => (
        <tr key={item.href} className="transition-colors hover:bg-surface-2/60">
          <Td first className="font-medium text-ink">
            {item.label}
          </Td>
          {roles.map((role, index) => {
            const open = seenBy.get(role.key)?.has(item.href) ?? false;
            const scope = SCOPE[item.href]?.[role.key];

            return (
              <Td
                key={role.key}
                last={index === roles.length - 1}
                align="right"
                className="text-ink-soft"
              >
                {open ? (
                  <span className="inline-flex flex-col items-end gap-0.5">
                    <span className="text-lime">✓</span>
                    {scope ? (
                      <span className="text-[11px] text-faint">{scope}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </Td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
