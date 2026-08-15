import type { Metadata } from 'next';
import Link from 'next/link';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell } from '@/components/app/table';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconLeads } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { takesLeads, type EmployeeRole } from '@/lib/employee-role';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { PLATFORM_LABELS } from '@/lib/labels';
import type { FunnelType } from '@/lib/metrics';
import { resolveRange } from '@/lib/period';
import {
  countUnassignedLeads,
  getAssignableEmployees,
  getCreativeOptions,
  getLeadStats,
  getLeads,
} from '@/lib/queries';
import {
  AddLeadButton,
  DistributeButton,
  LeadOwnerSelect,
  LeadRowActions,
  LeadStatusSelect,
} from './lead-controls';
import { StatusBreakdown } from './status-breakdown';

/** Лид без первого касания дольше суток — уже потерянные деньги. */
const UNTOUCHED_HOURS = 24;

export const metadata: Metadata = { title: 'Лиды' };

const COLUMNS = [
  { key: 'name', label: 'Лид' },
  { key: 'phone', label: 'Телефон' },
  { key: 'source', label: 'Источник' },
  { key: 'creative', label: 'Креатив' },
  { key: 'owner', label: 'Ответственный' },
  { key: 'created', label: 'Получен' },
  { key: 'status', label: 'Статус' },
  { key: 'actions', label: 'Действия', align: 'right' as const },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company, employee } = await requireCompanySession();
  // Менеджер ведёт свои заявки, но не распоряжается чужими: раздача и смена
  // ответственного — работа руководителя.
  const isStaff = employee !== null;
  const range = resolveRange(await searchParams, company.timezone);
  const funnelType = company.funnel_type as FunnelType;

  const [leads, stats, creatives, employees, queued] = await Promise.all([
    getLeads(company.id, range.from, range.to, company.timezone),
    getLeadStats(company.id, range.from, range.to, company.timezone),
    getCreativeOptions(company.id),
    getAssignableEmployees(company.id),
    countUnassignedLeads(company.id),
  ]);

  // Лиды раздаются менеджерам: РОП руководит, продажник подключается на пробном.
  const owners = employees
    .filter((employee) => takesLeads(employee.role as EmployeeRole))
    .map((employee) => ({ id: employee.id, name: employee.name }));

  const share = (value: number) => (stats.total ? (value / stats.total) * 100 : 0);

  return (
    <>
      <PageHeader
        title="Лиды"
        description="Каждый лид хранит источник, площадку и креатив — это и есть основа сквозной аналитики."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker range={range} />
            {isStaff ? null : <DistributeButton queued={queued} />}
            <AddLeadButton creatives={creatives} funnelType={funnelType} />
          </div>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Всего лидов"
            value={formatNumber(stats.total)}
            hint={`${formatNumber(stats.attributed)} с привязкой к креативу`}
          />
          <StatTile
            label="Дозвонились"
            value={formatNumber(stats.reached)}
            hint={`${formatPercent(share(stats.reached))} лидов — живой контакт`}
          />
          <StatTile
            label="Купили"
            value={formatNumber(stats.won)}
            hint={`Конверсия ${formatPercent(share(stats.won))}`}
            accent
          />
          <StatTile
            label="Ждут первого касания"
            value={formatNumber(stats.untouched)}
            hint={
              queued > 0
                ? `Без ответственного сейчас: ${formatNumber(queued)} — ждут смены`
                : `Новые лиды старше ${UNTOUCHED_HOURS} часов — их никто не взял`
            }
          />
        </div>

        {stats.total > 0 ? (
          <Card className="mt-4">
            <CardHeader
              title="Разбор по статусам"
              subtitle="Как менеджеры отработали лидов за выбранный период"
            />
            <StatusBreakdown
              counts={stats.counts}
              total={stats.total}
              funnelType={funnelType}
            />
          </Card>
        ) : null}

        <Card className="mt-4">
          <CardHeader
            title="Список лидов"
            subtitle={
              stats.total > leads.length
                ? `Показаны последние ${formatNumber(leads.length)} из ${formatNumber(stats.total)} за ${range.label}`
                : `Показаны все ${formatNumber(leads.length)} за ${range.label}`
            }
          />
          {leads.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconLeads className="size-5" />}
                title="Лидов за этот период нет"
                description="Добавьте лид вручную или подключите рекламные кабинеты — тогда заявки будут приходить автоматически."
                action={
                  <ButtonLink href="/dashboard/integrations" variant="secondary">
                    Настроить интеграции
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={1280}>
              {leads.map((lead) => (
                <tr key={lead.id} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="font-medium text-ink">
                    {lead.name || 'Без имени'}
                  </Td>
                  <Td className="tabular text-ink-soft">{lead.phone ?? '—'}</Td>
                  <Td className="text-ink-soft">
                    {lead.platform
                      ? (PLATFORM_LABELS[lead.platform] ?? lead.platform)
                      : (lead.source ?? '—')}
                  </Td>
                  <Td className="text-ink-soft">
                    {lead.creativeId && lead.creativeName ? (
                      <Link
                        href={`/dashboard/creatives/${lead.creativeId}`}
                        className="whitespace-nowrap text-lime transition-colors hover:text-lime-strong"
                      >
                        {lead.creativeName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    {isStaff ? (
                      <span className="text-[12.5px] text-ink-soft">
                        {lead.assignedName ?? '—'}
                      </span>
                    ) : (
                      <LeadOwnerSelect
                        leadId={lead.id}
                        assignedTo={lead.assignedTo}
                        employees={owners}
                      />
                    )}
                  </Td>
                  <Td className="tabular text-muted">{formatDateTime(lead.created_at)}</Td>
                  <Td>
                    <LeadStatusSelect
                      leadId={lead.id}
                      status={lead.status}
                      funnelType={funnelType}
                    />
                  </Td>
                  <Td last align="right">
                    <LeadRowActions
                      leadId={lead.id}
                      leadName={lead.name}
                      funnelType={funnelType}
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
