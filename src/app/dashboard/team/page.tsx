import type { Metadata } from 'next';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTeam } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import {
  SHIFT_MODE,
  formatDuration,
  formatSchedule,
  shiftDurationMinutes,
  type ShiftMode,
} from '@/lib/attendance';
import { requireFullAccess } from '@/lib/auth';
import { employeeRoleLabel } from '@/lib/employee-role';
import { formatDate, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import type { FunnelType } from '@/lib/metrics';
import { resolveRange } from '@/lib/period';
import { getTeam } from '@/lib/queries';
import {
  AddEmployeeButton,
  EmployeeRowActions,
  InviteButton,
  LoginButton,
  ScheduleButton,
} from './team-controls';

export const metadata: Metadata = { title: 'Команда' };

/**
 * Двенадцать колонок помещаются только на большом экране. На узком оставляем
 * то, ради чего сюда заходят с телефона: кто это, кем работает и кнопки —
 * выдать вход, пригласить в бота, изменить график.
 */
const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Сотрудник' },
  { key: 'role', label: 'Роль' },
  { key: 'telegram', label: 'Telegram', showFrom: 'lg' },
  { key: 'shift', label: 'Смена', showFrom: 'md' },
  { key: 'mode', label: 'Режим', showFrom: 'xl' },
  { key: 'schedule', label: 'График', showFrom: 'xl' },
  { key: 'hired', label: 'Принят', showFrom: 'xl' },
  { key: 'leads', label: 'Лиды', align: 'right' as const, showFrom: 'md' },
  { key: 'reached', label: 'Дозвон', align: 'right' as const, showFrom: 'lg' },
  { key: 'won', label: 'Продажи', align: 'right' as const, showFrom: 'md' },
  { key: 'revenue', label: 'Выручка', align: 'right' as const, showFrom: 'lg' },
  { key: 'actions', label: '', align: 'right' as const },
];

/** Ширина таблицы для каждого набора видимых колонок. */
const TABLE_MIN_WIDTH = { base: 420, md: 760, lg: 1100, xl: 1560 };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireFullAccess();
  const currency = company.sales_currency;
  const range = resolveRange(await searchParams, company.timezone);
  const funnelType = company.funnel_type as FunnelType;

  const team = await getTeam(company.id, range.from, range.to, company.timezone);
  const companyMode = company.shift_mode as ShiftMode;
  const active = team.filter((member) => member.status === 'active');
  const linked = active.filter((member) => member.telegramLinked).length;
  const revenue = team.reduce((total, member) => total + member.revenue, 0);

  return (
    <>
      <PageHeader
        title="Команда"
        description="Кто работает в компании и что каждый сделал за выбранный период."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker range={range} />
            <AddEmployeeButton funnelType={funnelType} />
          </div>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Сотрудников"
            value={formatNumber(active.length)}
            hint={
              team.length > active.length
                ? `${formatNumber(team.length - active.length)} уволены, история сохранена`
                : 'Все активны'
            }
          />
          <StatTile
            label="Подключены к Telegram"
            value={`${formatNumber(linked)} из ${formatNumber(active.length)}`}
            hint="Привязка появится вместе с ботом"
          />
          <StatTile
            label="Сейчас на смене"
            value={`${formatNumber(active.filter((member) => member.onShift).length)} из ${formatNumber(active.length)}`}
            hint="Лиды получают только те, кто открыл смену"
          />
          <StatTile
            label="Лидов в работе у команды"
            value={formatNumber(team.reduce((total, member) => total + member.leads, 0))}
            hint={`За ${range.label}`}
          />
          <StatTile
            label="Выручка команды"
            value={formatMoney(revenue, { compact: true, currency })}
            hint="Продажи по лидам с ответственным"
            accent
          />
        </div>

        <Card className="mt-4">
          <CardHeader
            title="Сотрудники"
            subtitle="Показатели считаются по лидам, где сотрудник указан ответственным"
          />
          {team.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconTeam className="size-5" />}
                title="Сотрудников пока нет"
                description="Добавьте менеджеров — после этого в разделе «Лиды» можно будет назначать ответственного за каждую заявку."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={TABLE_MIN_WIDTH}>
              {team.map((member) => (
                <tr
                  key={member.id}
                  className={`transition-colors hover:bg-surface-2/60 ${
                    member.status === 'fired' ? 'opacity-55' : ''
                  }`}
                >
                  <Td first className="font-medium text-ink">
                    <div className="flex items-center gap-2">
                      {member.fullName}
                      {member.status === 'fired' ? (
                        <Badge tone="neutral">Уволен</Badge>
                      ) : null}
                    </div>
                    {member.phone ? (
                      <span className="tabular mt-0.5 block text-[12px] text-faint">
                        {member.phone}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-ink-soft">{employeeRoleLabel(member.role)}</Td>
                  <Td showFrom="lg" className="text-ink-soft">
                    {member.telegramUsername ? (
                      `@${member.telegramUsername}`
                    ) : (
                      <span className="text-faint">не подключён</span>
                    )}
                  </Td>
                  <Td showFrom="md">
                    {member.onShift ? (
                      <Badge tone="positive">
                        <StatusDot tone="positive" />
                        На смене
                      </Badge>
                    ) : (
                      <span className="text-[12.5px] text-faint">не на смене</span>
                    )}
                  </Td>
                  <Td showFrom="xl" className="text-ink-soft">
                    {SHIFT_MODE[member.rules.mode].label}
                    <span className="mt-0.5 block text-[11.5px] text-faint">
                      {member.shiftMode ? 'лично' : 'как в компании'}
                    </span>
                  </Td>
                  <Td showFrom="xl" className="text-ink-soft">
                    <span className="tabular">{formatSchedule(member.rules)}</span>
                    <span className="mt-0.5 block text-[11.5px] text-faint">
                      {formatDuration(
                        shiftDurationMinutes(
                          member.rules.workStartTime,
                          member.rules.workEndTime,
                        ),
                      )}
                      {member.rules.personalSchedule ? ' · свой график' : ' · как в компании'}
                    </span>
                  </Td>
                  <Td showFrom="xl" className="tabular text-muted">
                    {formatDate(member.hiredAt)}
                  </Td>
                  <Td showFrom="md" align="right" className="tabular text-ink">
                    {formatNumber(member.leads)}
                  </Td>
                  <Td showFrom="lg" align="right" className="tabular text-ink-soft">
                    {member.leads
                      ? `${formatNumber(member.reached)} · ${formatPercent(
                          (member.reached / member.leads) * 100,
                          0,
                        )}`
                      : '—'}
                  </Td>
                  <Td showFrom="md" align="right" className="tabular text-ink">
                    {formatNumber(member.won)}
                  </Td>
                  <Td showFrom="lg" align="right" className="tabular font-medium text-ink">
                    {member.revenue ? formatMoney(member.revenue, { compact: true, currency }) : '—'}
                  </Td>
                  <Td last align="right">
                    <div className="flex items-center justify-end gap-1">
                      {member.status === 'active' ? (
                        <ScheduleButton
                          employeeId={member.id}
                          fullName={member.fullName}
                          defaults={{
                            shiftMode: member.shiftMode,
                            workStartTime: member.workStartTime,
                            workEndTime: member.workEndTime,
                            workDays: member.workDays,
                            lateGraceMinutes: member.lateGraceMinutes,
                          }}
                          company={{
                            mode: companyMode,
                            workStartTime: company.work_start_time,
                            workEndTime: company.work_end_time,
                            workDays: company.work_days,
                            lateGraceMinutes: company.late_grace_minutes,
                          }}
                        />
                      ) : null}
                      {member.status === 'active' ? (
                        <InviteButton
                          employeeId={member.id}
                          fullName={member.fullName}
                          linked={member.telegramLinked}
                        />
                      ) : null}
                      {member.status === 'active' ? (
                        <LoginButton
                          employeeId={member.id}
                          fullName={member.fullName}
                          hasLogin={member.hasLogin}
                          loginEmail={member.loginEmail}
                        />
                      ) : null}
                      <EmployeeRowActions
                        employeeId={member.id}
                        fullName={member.fullName}
                        status={member.status}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </TableShell>
          )}
        </Card>
      </PageBody>
    </>
  );
}
