import type { Metadata } from 'next';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell } from '@/components/app/table';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTeam } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import {
  ATTENDANCE_STATUS,
  SHIFT_MODE,
  isAttendanceStatus,
  manualStatusesFor,
  type ShiftMode,
} from '@/lib/attendance';
import { requireCompanySession } from '@/lib/auth';
import { employeeRoleLabel } from '@/lib/employee-role';
import { formatNumber } from '@/lib/format';
import { resolveRange, toIsoDate } from '@/lib/period';
import { getAttendance } from '@/lib/queries';
import { MarkButton } from './attendance-controls';

export const metadata: Metadata = { title: 'Посещение' };

const COLUMNS = [
  { key: 'name', label: 'Сотрудник' },
  { key: 'role', label: 'Роль' },
  { key: 'now', label: 'Сейчас' },
  { key: 'days', label: 'Смен', align: 'right' as const },
  { key: 'late', label: 'Опозданий', align: 'right' as const },
  { key: 'hours', label: 'Часов', align: 'right' as const },
  { key: 'marks', label: 'Отметки' },
  { key: 'actions', label: '', align: 'right' as const },
];

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();
  const range = resolveRange(await searchParams);
  const rows = await getAttendance(company.id, range.from, range.to);

  const mode = company.shift_mode as ShiftMode;
  const manual = manualStatusesFor(company.attendance_statuses);
  const today = toIsoDate(new Date());

  const onShift = rows.filter((row) => row.onShiftNow).length;
  const late = rows.reduce((total, row) => total + row.lateDays, 0);
  const hours = rows.reduce((total, row) => total + row.minutes, 0) / 60;

  return (
    <>
      <PageHeader
        title="Посещение"
        description="Смены, опоздания и табель. Отметки «на смене» и «опоздал» ставит сама система."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Сейчас на смене"
            value={`${formatNumber(onShift)} из ${formatNumber(rows.length)}`}
            hint={SHIFT_MODE[mode].label}
          />
          <StatTile
            label="Смен за период"
            value={formatNumber(rows.reduce((total, row) => total + row.shiftDays, 0))}
          />
          <StatTile
            label="Опозданий"
            value={formatNumber(late)}
            hint={`Начало дня — ${company.work_start_time.slice(0, 5)}, допуск ${company.late_grace_minutes} мин`}
          />
          <StatTile
            label="Отработано часов"
            value={formatNumber(hours, hours < 100 ? 1 : 0)}
            hint="Открытая смена считается до текущего момента"
            accent
          />
        </div>

        {mode === 'always' ? (
          <p className="mt-4 rounded-panel border border-line bg-surface-2/40 px-4 py-3 text-[13px] text-muted">
            Компания работает без смен — сотрудники получают лиды всегда, поэтому часы
            и опоздания не считаются. Режим меняется в «Настройках → Смены и офис».
          </p>
        ) : null}

        <Card className="mt-4">
          <CardHeader
            title="Табель"
            subtitle={`За ${range.label}`}
          />
          {rows.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconTeam className="size-5" />}
                title="Сотрудников нет"
                description="Добавьте команду в разделе «Команда» — табель заполнится сам, как только они начнут открывать смены."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={1080}>
              {rows.map((row) => {
                const marks = Object.entries(row.days)
                  .sort(([a], [b]) => (a < b ? 1 : -1))
                  .filter(([, status]) => isAttendanceStatus(status))
                  .slice(0, 3);

                return (
                  <tr key={row.employeeId} className="transition-colors hover:bg-surface-2/60">
                    <Td first className="font-medium text-ink">
                      {row.fullName}
                    </Td>
                    <Td className="text-ink-soft">{employeeRoleLabel(row.role)}</Td>
                    <Td>
                      {row.onShiftNow ? (
                        <Badge tone="positive">
                          <StatusDot tone="positive" />
                          На смене
                        </Badge>
                      ) : (
                        <span className="text-[12.5px] text-faint">—</span>
                      )}
                    </Td>
                    <Td align="right" className="tabular text-ink">
                      {formatNumber(row.shiftDays)}
                    </Td>
                    <Td align="right" className="tabular text-ink-soft">
                      {row.lateDays ? formatNumber(row.lateDays) : '—'}
                    </Td>
                    <Td align="right" className="tabular text-ink">
                      {row.minutes ? formatNumber(row.minutes / 60, 1) : '—'}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {marks.length === 0 ? (
                          <span className="text-[12.5px] text-faint">нет</span>
                        ) : (
                          marks.map(([date, status]) => (
                            <Badge
                              key={date}
                              tone={ATTENDANCE_STATUS[status as keyof typeof ATTENDANCE_STATUS].tone}
                            >
                              {ATTENDANCE_STATUS[status as keyof typeof ATTENDANCE_STATUS].label}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td last align="right">
                      <MarkButton
                        employeeId={row.employeeId}
                        fullName={row.fullName}
                        statuses={manual}
                        today={today}
                      />
                    </Td>
                  </tr>
                );
              })}
            </TableShell>
          )}
        </Card>
      </PageBody>
    </>
  );
}
