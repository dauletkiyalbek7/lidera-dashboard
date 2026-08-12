import type { Metadata } from 'next';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTeam } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { employeeRoleLabel } from '@/lib/employee-role';
import { formatDate, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import type { FunnelType } from '@/lib/metrics';
import { resolveRange } from '@/lib/period';
import { getTeam } from '@/lib/queries';
import { AddEmployeeButton, EmployeeRowActions } from './team-controls';

export const metadata: Metadata = { title: 'Команда' };

const COLUMNS = [
  { key: 'name', label: 'Сотрудник' },
  { key: 'role', label: 'Роль' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'hired', label: 'Принят' },
  { key: 'leads', label: 'Лиды', align: 'right' as const },
  { key: 'reached', label: 'Дозвон', align: 'right' as const },
  { key: 'won', label: 'Продажи', align: 'right' as const },
  { key: 'revenue', label: 'Выручка', align: 'right' as const },
  { key: 'actions', label: '', align: 'right' as const },
];

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();
  const range = resolveRange(await searchParams);
  const funnelType = company.funnel_type as FunnelType;

  const team = await getTeam(company.id, range.from, range.to);
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
            label="Лидов в работе у команды"
            value={formatNumber(team.reduce((total, member) => total + member.leads, 0))}
            hint={`За ${range.label}`}
          />
          <StatTile
            label="Выручка команды"
            value={formatMoney(revenue, { compact: true })}
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
            <TableShell columns={COLUMNS} minWidth={1080}>
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
                  <Td className="text-ink-soft">
                    {member.telegramUsername ? (
                      `@${member.telegramUsername}`
                    ) : (
                      <span className="text-faint">не подключён</span>
                    )}
                  </Td>
                  <Td className="tabular text-muted">{formatDate(member.hiredAt)}</Td>
                  <Td align="right" className="tabular text-ink">
                    {formatNumber(member.leads)}
                  </Td>
                  <Td align="right" className="tabular text-ink-soft">
                    {member.leads
                      ? `${formatNumber(member.reached)} · ${formatPercent(
                          (member.reached / member.leads) * 100,
                          0,
                        )}`
                      : '—'}
                  </Td>
                  <Td align="right" className="tabular text-ink">
                    {formatNumber(member.won)}
                  </Td>
                  <Td align="right" className="tabular font-medium text-ink">
                    {member.revenue ? formatMoney(member.revenue, { compact: true }) : '—'}
                  </Td>
                  <Td last align="right">
                    <EmployeeRowActions
                      employeeId={member.id}
                      fullName={member.fullName}
                      status={member.status}
                    />
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
