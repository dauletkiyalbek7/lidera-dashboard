import type { Metadata } from 'next';
import Link from 'next/link';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { DepartmentFilter } from '@/components/app/department-filter';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconSales } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireSalesAccess } from '@/lib/auth';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { SALE_STATUS } from '@/lib/labels';
import { averageCheck } from '@/lib/metrics';
import { currentRange } from '@/lib/period-preference';
import { getDepartments, getLeads, getSales } from '@/lib/queries';
import { RefundButton } from '@/app/dashboard/returns/return-controls';
import { AddSaleButton, SaleStatusSelect } from './sale-controls';

export const metadata: Metadata = { title: 'Продажи' };

/**
 * На телефоне важны трое: кто купил, на сколько и подтверждена ли продажа.
 * Телефон и ролик подключаются по мере ширины экрана — ими пользуются, когда
 * разбираются с конкретным клиентом, а не когда смотрят итог дня.
 *
 * Колонка с роликом — то, ради чего вся платформа и строилась: здесь видно не
 * «продали на столько-то», а «эта реклама принесла этого покупателя».
 */
function columnsFor(own: boolean, canEdit: boolean): TableColumn[] {
  return [
    { key: 'lead', label: 'Клиент' },
    { key: 'phone', label: 'Телефон', showFrom: 'lg' },
    { key: 'creative', label: 'Пришёл с ролика', showFrom: 'lg' },
    { key: 'department', label: 'Отдел', showFrom: 'xl' },
    // Кто закрыл — первый вопрос руководителя к списку продаж. Себе человек
    // эту колонку не показывает: там всюду стояло бы его собственное имя.
    ...(own ? [] : [{ key: 'seller', label: 'Продавец', showFrom: 'md' as const }]),
    { key: 'product', label: 'Продукт', showFrom: 'md' },
    { key: 'date', label: 'Дата', showFrom: 'md' },
    { key: 'status', label: 'Статус' },
    { key: 'amount', label: 'Сумма', align: 'right' as const },
    ...(canEdit ? [{ key: 'actions', label: '', align: 'right' as const }] : []),
  ];
}

/** Ширина таблицы для каждого набора видимых колонок. */
const TABLE_MIN_WIDTH = { base: 420, md: 900, lg: 1240, xl: 1400 };

/** Статус чека, который менять нельзя: у продавца это отметка, а не выбор. */
function SaleStatusBadge({ status }: { status: string }) {
  const meta = SALE_STATUS[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    department?: string;
  }>;
}) {
  const { company, employee } = await requireSalesAccess();
  const currency = company.sales_currency;

  // Продавец и менеджер видят только свои чеки — так решает база, а не эта
  // строка: она лишь убирает колонку «Продавец», где стояло бы одно и то же имя.
  const own = employee !== null && employee.role !== 'rop';

  // Деньги правит директор. У сотрудника — включая РОПа — профиль без права
  // записи, и база откажет: показывать кнопку, которая не сработает, нельзя.
  const canEdit = employee === null;
  const params = await searchParams;
  const range = await currentRange(params, company.timezone);

  // Отдел из адреса: у проекта бывает два отдела продаж, и руководитель
  // смотрит их порознь — как в «Лидах».
  const departmentId = params.department ?? null;

  const [sales, leadPage, departments] = await Promise.all([
    getSales(company.id, range.from, range.to, departmentId),
    // Список для выбора при записи продажи: берём столько же, сколько даёт
    // самая большая страница списка заявок.
    getLeads(company.id, range.from, range.to, company.timezone, departmentId, 1, 100),
    getDepartments(company.id),
  ]);

  const activeDepartments = departments.filter((row) => row.status === 'active');

  // Подпись лида в выпадающем списке: по имени и телефону его легко узнать.
  const leadOptions = leadPage.items.map((lead) => ({
    id: lead.id,
    label: [lead.name || 'Без имени', lead.phone].filter(Boolean).join(' · '),
  }));

  const paid = sales.filter((sale) => sale.status === 'paid');
  const revenue = paid.reduce((total, sale) => total + sale.amount, 0);

  return (
    <>
      <PageHeader
        title="Продажи"
        description={
          own
            ? 'Ваши продажи: что вы закрыли и на какую сумму.'
            : 'Закрытая часть цепочки: именно эти деньги превращают лиды в ROAS.'
        }
        action={
          <div className="flex flex-wrap items-center justify-end gap-4">
            {canEdit ? <AddSaleButton leads={leadOptions} /> : null}
            <DateRangePicker range={range} />
          </div>
        }
      />

      <PageBody>
        <DepartmentFilter departments={activeDepartments} selected={departmentId} />

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
            <TableShell columns={columnsFor(own, canEdit)} minWidth={TABLE_MIN_WIDTH}>
              {sales.map((sale) => (
                <tr key={sale.id} className="transition-colors hover:bg-surface-2/60">
                  <Td
                    first
                    truncate="md"
                    title={sale.leadName ?? undefined}
                    className="font-medium text-ink"
                  >
                    {sale.leadName ?? 'Без привязки'}
                  </Td>
                  <Td showFrom="lg" className="tabular text-ink-soft">
                    {sale.leadPhone ?? '—'}
                  </Td>
                  <Td
                    showFrom="lg"
                    truncate="sm"
                    title={sale.creativeName ?? undefined}
                    className="text-ink-soft"
                  >
                    {sale.creativeId && sale.creativeName ? (
                      <Link
                        href={`/dashboard/creatives/${sale.creativeId}`}
                        className="whitespace-nowrap text-lime transition-colors hover:text-lime-strong"
                      >
                        {sale.creativeName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td showFrom="xl" className="text-ink-soft">
                    {sale.departmentName ?? '—'}
                  </Td>
                  {own ? null : (
                    <Td showFrom="md" truncate="sm" className="text-ink-soft">
                      {sale.sellerName ?? '—'}
                    </Td>
                  )}
                  <Td
                    showFrom="md"
                    truncate="sm"
                    title={sale.product ?? undefined}
                    className="text-ink-soft"
                  >
                    {sale.product ?? '—'}
                  </Td>
                  <Td showFrom="md" className="tabular text-ink-soft">
                    {formatDate(sale.sale_date)}
                  </Td>
                  <Td>
                    {canEdit ? (
                      <SaleStatusSelect saleId={sale.id} status={sale.status} />
                    ) : (
                      <SaleStatusBadge status={sale.status} />
                    )}
                  </Td>
                  <Td
                    last={!canEdit}
                    align="right"
                    className="tabular font-medium text-ink"
                  >
                    {formatMoney(sale.amount, { currency })}
                  </Td>
                  {canEdit ? (
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
                  ) : null}
                </tr>
              ))}
            </TableShell>
          )}
        </Card>
      </PageBody>
    </>
  );
}
