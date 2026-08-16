import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconSales } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireFullAccess } from '@/lib/auth';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { averageCheck } from '@/lib/metrics';
import { resolveRange } from '@/lib/period';
import { getLeads, getSales } from '@/lib/queries';
import { RefundButton } from '@/app/dashboard/returns/return-controls';
import { AddSaleButton, SaleStatusSelect } from './sale-controls';

export const metadata: Metadata = { title: 'Продажи' };

/** На телефоне важны трое: кто купил, на сколько и подтверждена ли продажа. */
const COLUMNS: TableColumn[] = [
  { key: 'lead', label: 'Клиент' },
  { key: 'product', label: 'Продукт', showFrom: 'md' },
  { key: 'date', label: 'Дата', showFrom: 'md' },
  { key: 'status', label: 'Статус' },
  { key: 'amount', label: 'Сумма', align: 'right' as const },
  { key: 'actions', label: '', align: 'right' as const },
];

/** Ширина таблицы для каждого набора видимых колонок. */
const TABLE_MIN_WIDTH = { base: 420, md: 900 };

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireFullAccess();
  const currency = company.sales_currency;
  const range = resolveRange(await searchParams, company.timezone);

  const [sales, leads] = await Promise.all([
    getSales(company.id, range.from, range.to),
    getLeads(company.id, range.from, range.to, company.timezone),
  ]);

  // Подпись лида в выпадающем списке: по имени и телефону его легко узнать.
  const leadOptions = leads.map((lead) => ({
    id: lead.id,
    label: [lead.name || 'Без имени', lead.phone].filter(Boolean).join(' · '),
  }));

  const paid = sales.filter((sale) => sale.status === 'paid');
  const revenue = paid.reduce((total, sale) => total + sale.amount, 0);

  return (
    <>
      <PageHeader
        title="Продажи"
        description="Закрытая часть цепочки: именно эти деньги превращают лиды в ROAS."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker range={range} />
            <AddSaleButton leads={leadOptions} />
          </div>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Продаж" value={formatNumber(paid.length)} />
          <StatTile label="Выручка" value={formatMoney(revenue, { currency })} accent />
          <StatTile
            label="Средний чек"
            value={formatMoney(averageCheck(revenue, paid.length), { currency })}
          />
        </div>

        <Card className="mt-4">
          <CardHeader title="Список продаж" subtitle={`Период: ${range.label}`} />
          {sales.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconSales className="size-5" />}
                title="Продаж за этот период нет"
                description="Запишите продажу вручную или оформите её прямо из карточки лида в разделе «Лиды»."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={TABLE_MIN_WIDTH}>
              {sales.map((sale) => (
                <tr key={sale.id} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="font-medium text-ink">
                    {sale.leadName ?? 'Без привязки'}
                  </Td>
                  <Td showFrom="md" className="text-ink-soft">
                    {sale.product ?? '—'}
                  </Td>
                  <Td showFrom="md" className="tabular text-ink-soft">
                    {formatDate(sale.sale_date)}
                  </Td>
                  <Td>
                    <SaleStatusSelect saleId={sale.id} status={sale.status} />
                  </Td>
                  <Td align="right" className="tabular font-medium text-ink">
                    {formatMoney(sale.amount, { currency })}
                  </Td>
                  <Td last align="right">
                    {sale.status === 'paid' ? (
                      <RefundButton
                        saleId={sale.id}
                        saleAmount={sale.amount}
                        leadName={sale.leadName}
                        currency={currency}
                      />
                    ) : null}
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
