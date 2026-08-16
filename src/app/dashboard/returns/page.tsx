import type { Metadata } from 'next';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconReceipts } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireFullAccess } from '@/lib/auth';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { resolveRange } from '@/lib/period';
import { getReturns, getSales } from '@/lib/queries';

export const metadata: Metadata = { title: 'Возвраты' };

/** На узком экране остаётся суть: кому и сколько вернули. */
const COLUMNS: TableColumn[] = [
  { key: 'lead', label: 'Клиент' },
  { key: 'product', label: 'Продукт', showFrom: 'lg' },
  { key: 'saleDate', label: 'Дата продажи', showFrom: 'xl' },
  { key: 'date', label: 'Когда вернули', showFrom: 'md' },
  { key: 'reason', label: 'Причина', showFrom: 'md' },
  { key: 'by', label: 'Оформил', showFrom: 'lg' },
  { key: 'amount', label: 'Сумма', align: 'right' as const },
];

/** Ширина таблицы для каждого набора видимых колонок. */
const TABLE_MIN_WIDTH = { base: 360, md: 760, lg: 1060, xl: 1240 };

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireFullAccess();
  const currency = company.sales_currency;
  const range = resolveRange(await searchParams, company.timezone);

  const [returns, sales] = await Promise.all([
    getReturns(company.id, range.from, range.to, company.timezone),
    getSales(company.id, range.from, range.to),
  ]);

  const total = returns.reduce((sum, row) => sum + row.amount, 0);
  const revenue = sales
    .filter((sale) => sale.status === 'paid')
    .reduce((sum, sale) => sum + sale.amount, 0);
  // Доля от выручки: сама выручка возвраты уже не содержит, поэтому складываем
  // оставшееся с вернувшимся — это и есть все проданные деньги.
  const gross = revenue + total;

  return (
    <>
      <PageHeader
        title="Возвраты"
        description="Деньги, которые вернулись клиентам. Оформляет РОП или директор — запись остаётся навсегда."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Вернули"
            value={formatMoney(total, { currency })}
            hint={`За ${range.label}`}
          />
          <StatTile
            label="Возвратов"
            value={formatNumber(returns.length)}
            hint={returns.length ? `Средний ${formatMoney(total / returns.length, { currency })}` : 'Ни одного за период'}
          />
          <StatTile
            label="Доля от продаж"
            value={gross ? formatPercent((total / gross) * 100, 1) : '—'}
            hint="Возвраты ÷ все проданные деньги"
          />
          <StatTile
            label="Выручка после возвратов"
            value={formatMoney(revenue, { currency })}
            hint="Столько осталось у компании"
            accent
          />
        </div>

        <Card className="mt-4">
          <CardHeader
            title="Список возвратов"
            subtitle="Оформить возврат можно в разделе «Продажи» — кнопкой в строке оплаченной продажи"
          />
          {returns.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconReceipts className="size-5" />}
                title="Возвратов за этот период нет"
                description="Это хорошая новость. Когда возврат понадобится, откройте «Продажи» и нажмите «Возврат» в строке нужной оплаты."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={TABLE_MIN_WIDTH}>
              {returns.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="font-medium text-ink">
                    {row.leadName ?? 'Без привязки'}
                  </Td>
                  <Td showFrom="lg" className="text-ink-soft">
                    {row.product ?? '—'}
                  </Td>
                  <Td showFrom="xl" className="tabular text-muted">
                    {formatDate(row.saleDate)}
                  </Td>
                  <Td showFrom="md" className="tabular text-ink-soft">
                    {formatDateTime(row.createdAt)}
                  </Td>
                  <Td showFrom="md" className="text-ink-soft">
                    {row.reason ?? <span className="text-faint">не указана</span>}
                  </Td>
                  <Td showFrom="lg" className="text-ink-soft">
                    {row.processedBy ?? <span className="text-faint">директор</span>}
                  </Td>
                  <Td last align="right" className="tabular font-medium text-negative">
                    −{formatMoney(row.amount, { currency })}
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
