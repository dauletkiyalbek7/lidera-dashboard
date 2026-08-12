import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { PeriodTabs } from '@/components/app/period-tabs';
import { Td, TableShell } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconSales } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { SALE_STATUS, statusOf } from '@/lib/labels';
import { averageCheck } from '@/lib/metrics';
import { resolvePeriod } from '@/lib/period';
import { getSales } from '@/lib/queries';

export const metadata: Metadata = { title: 'Продажи' };

const COLUMNS = [
  { key: 'lead', label: 'Клиент' },
  { key: 'product', label: 'Продукт' },
  { key: 'date', label: 'Дата' },
  { key: 'status', label: 'Статус' },
  { key: 'amount', label: 'Сумма', align: 'right' as const },
];

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { company } = await requireCompanySession();
  const period = resolvePeriod((await searchParams).period);
  const sales = await getSales(company.id, period.from, period.to);

  const paid = sales.filter((sale) => sale.status === 'paid');
  const revenue = paid.reduce((total, sale) => total + sale.amount, 0);

  return (
    <>
      <PageHeader
        title="Продажи"
        description="Закрытая часть цепочки: именно эти деньги превращают лиды в ROAS."
        action={<PeriodTabs active={period.key} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Продаж" value={formatNumber(paid.length)} />
          <StatTile label="Выручка" value={formatMoney(revenue)} accent />
          <StatTile
            label="Средний чек"
            value={formatMoney(averageCheck(revenue, paid.length))}
          />
        </div>

        <Card className="mt-4">
          <CardHeader title="Список продаж" subtitle={`Период: ${period.label}`} />
          {sales.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconSales className="size-5" />}
                title="Продаж за этот период нет"
                description="Продажи можно заводить вручную или получать из CRM и Telegram-бота — интеграции подключаются в настройках."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={780}>
              {sales.map((sale) => {
                const status = statusOf(SALE_STATUS, sale.status);
                return (
                  <tr key={sale.id} className="transition-colors hover:bg-surface-2/60">
                    <Td first className="font-medium text-ink">
                      {sale.leadName ?? 'Без имени'}
                    </Td>
                    <Td className="text-ink-soft">{sale.product ?? '—'}</Td>
                    <Td className="tabular text-ink-soft">{formatDate(sale.sale_date)}</Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td last align="right" className="tabular font-medium text-ink">
                      {formatMoney(sale.amount)}
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
