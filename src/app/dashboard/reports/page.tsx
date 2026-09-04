import type { Metadata } from 'next';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconReports } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireReportsAccess } from '@/lib/auth';
import { employeeRoleLabel } from '@/lib/employee-role';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { leadStatusFor, leadStatusesFor } from '@/lib/lead-status';
import { conversionRate, type FunnelType } from '@/lib/metrics';
import { currentRange } from '@/lib/period-preference';
import { getSalesReport, type SalesReportRow } from '@/lib/queries';
import { TRIAL_STATUS, TRIAL_STATUS_ORDER } from '@/lib/trial-status';
import { trialWords } from '@/lib/trial-term';

export const metadata: Metadata = { title: 'Отчёты' };

/**
 * Отчёт отдела продаж — рабочий стол РОПа.
 *
 * Две таблицы, потому что работа разная. Менеджер отвечает за то, что стало с
 * выданными ему заявками: до скольких дозвонился, сколько записал на урок,
 * сколько потерял. Продажник отвечает за урок и решение после него, и там свои
 * исходы — в том числе отказ банка по рассрочке, который в его провалы не
 * идёт: клиент хотел купить.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireReportsAccess();
  const funnelType = company.funnel_type as FunnelType;
  const words = trialWords(company.trial_term);
  const currency = company.sales_currency;

  const range = await currentRange(await searchParams, company.timezone);
  const report = await getSalesReport(company.id, range.from, range.to, company.timezone);

  const leadStatuses = leadStatusesFor(funnelType);

  // В таблицу менеджеров попадают все, у кого были заявки, — и уволенные тоже:
  // их работа за прошлый период никуда не делась.
  const managers = report.rows.filter(
    (row) => row.role === 'manager' || row.leads > 0 || row.worked > 0,
  );

  const sellers =
    funnelType === 'trial'
      ? report.rows.filter((row) => row.role === 'salesperson' || row.trials > 0)
      : [];

  return (
    <>
      <PageHeader
        title="Отчёты"
        description="Что сделал каждый человек в отделе за выбранный период."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile
            label="Заявок выдано"
            value={formatNumber(report.totals.leads)}
            hint={`За ${range.label}`}
          />
          <StatTile
            label="Отработано"
            value={formatNumber(report.totals.worked)}
            hint={`${formatPercent(
              conversionRate(report.totals.worked, report.totals.leads),
            )} от выданных`}
          />
          {funnelType === 'trial' ? (
            <StatTile
              label={words.middleStep}
              value={formatNumber(report.totals.trialsHeld)}
              hint="Урок состоялся"
            />
          ) : null}
          <StatTile
            label="Продаж"
            value={formatNumber(report.totals.salesCount)}
            hint={`Конверсия ${formatPercent(
              conversionRate(report.totals.salesCount, report.totals.leads),
            )}`}
          />
          <StatTile
            label="Выручка отдела"
            value={formatMoney(report.totals.revenue, { compact: true, currency })}
            hint="Чеки, проведённые за период"
            accent
          />
        </div>

        <Card className="mt-4">
          <CardHeader
            title="Менеджеры"
            subtitle="Заявки, выданные за период, и что с ними стало сейчас"
          />
          {managers.length === 0 ? (
            <Empty text="За этот период заявки никому не выдавались." />
          ) : (
            <TableShell
              columns={managerColumns(leadStatuses, company.trial_term)}
              minWidth={{ base: 420, md: 700, lg: 900, xl: 1180 }}
            >
              {managers.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-surface-2/60">
                  <Person row={row} />
                  <Td align="right" className="tabular font-medium text-ink">
                    {formatNumber(row.leads)}
                  </Td>
                  <Td align="right" showFrom="md" className="tabular text-ink-soft">
                    {row.leads > 0
                      ? `${formatNumber(row.worked)} · ${formatPercent(
                          conversionRate(row.worked, row.leads),
                          0,
                        )}`
                      : '—'}
                  </Td>
                  {leadStatuses.map((status) => (
                    <Td
                      key={status}
                      align="right"
                      showFrom={status === 'sale' ? undefined : 'lg'}
                      className="tabular text-ink-soft"
                    >
                      {count(row.leadsByStatus[status])}
                    </Td>
                  ))}
                  <Td last align="right" className="tabular font-medium text-lime">
                    {formatPercent(conversionRate(row.leadsByStatus.sale ?? 0, row.leads), 0)}
                  </Td>
                </tr>
              ))}
            </TableShell>
          )}
        </Card>

        {funnelType === 'trial' ? (
          <Card className="mt-4">
            <CardHeader
              title="Продажники"
              subtitle={`${words.section} за период и чем закончилось решение клиента`}
            />
            {sellers.length === 0 ? (
              <Empty text="За этот период уроки никому не назначались." />
            ) : (
              <TableShell
                columns={sellerColumns(words.column)}
                minWidth={{ base: 420, md: 720, lg: 980, xl: 1240 }}
              >
                {sellers.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-surface-2/60">
                    <Person row={row} />
                    <Td align="right" className="tabular font-medium text-ink">
                      {formatNumber(row.trials)}
                    </Td>
                    {TRIAL_STATUS_ORDER.map((status) => (
                      <Td
                        key={status}
                        align="right"
                        showFrom={status === 'sale' ? undefined : 'lg'}
                        className="tabular text-ink-soft"
                      >
                        {count(row.trialsByStatus[status])}
                      </Td>
                    ))}
                    <Td last align="right" className="tabular font-medium text-lime">
                      {formatMoney(row.revenue, { compact: true, currency })}
                    </Td>
                  </tr>
                ))}
              </TableShell>
            )}
          </Card>
        ) : null}
      </PageBody>
    </>
  );
}

/** Имя, роль и пометка об увольнении — одинаково в обеих таблицах. */
function Person({ row }: { row: SalesReportRow }) {
  return (
    <Td first truncate="md" title={row.name}>
      <span className="font-medium text-ink">{row.name}</span>
      <span className="ml-2 text-[12px] text-muted">{employeeRoleLabel(row.role)}</span>
      {row.fired ? (
        <Badge tone="neutral" className="ml-2">
          уволен
        </Badge>
      ) : null}
    </Td>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="p-5 sm:p-6">
      <EmptyState
        icon={<IconReports className="size-5" />}
        title="Пока пусто"
        description={text}
      />
    </div>
  );
}

/** Ноль в таблице читается хуже прочерка: глаз цепляется за цифры, которых нет. */
function count(value: number | undefined): string {
  return value ? formatNumber(value) : '—';
}

function managerColumns(statuses: string[], trialTerm: string | null): TableColumn[] {
  return [
    { key: 'name', label: 'Сотрудник' },
    { key: 'leads', label: 'Выдано', align: 'right' },
    { key: 'worked', label: 'Отработано', align: 'right', showFrom: 'md' },
    ...statuses.map((status) => ({
      key: status,
      label: leadStatusFor(status, trialTerm).label,
      align: 'right' as const,
      showFrom: status === 'sale' ? undefined : ('lg' as const),
    })),
    { key: 'conversion', label: 'Конверсия', align: 'right' },
  ];
}

function sellerColumns(middle: string): TableColumn[] {
  return [
    { key: 'name', label: 'Сотрудник' },
    { key: 'trials', label: middle, align: 'right' },
    ...TRIAL_STATUS_ORDER.map((status) => ({
      key: status,
      label: TRIAL_STATUS[status].label,
      align: 'right' as const,
      showFrom: status === 'sale' ? undefined : ('lg' as const),
    })),
    { key: 'revenue', label: 'Выручка', align: 'right' },
  ];
}
