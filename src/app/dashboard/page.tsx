import type { Metadata } from 'next';

import { CreativeTable } from '@/components/app/creative-table';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { DepartmentFilter } from '@/components/app/department-filter';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Funnel } from '@/components/charts/funnel';
import { TrendChart } from '@/components/charts/trend-chart';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAds } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireFullAccess } from '@/lib/auth';
import { currencySymbol, formatMoney, formatNumber, formatPercent, formatRatio } from '@/lib/format';
import { funnelLabels, middleStepValue, type FunnelType } from '@/lib/metrics';
import { moneyView } from '@/lib/money-view';
import { currentRange } from '@/lib/period-preference';
import { getAdSpendCurrency, getDashboardData, getDepartments } from '@/lib/queries';

export const metadata: Metadata = { title: 'Главная' };

/**
 * Разбивка по отделам продаж: у каждого свои кампании, свой бюджет и свои
 * заявки. Валюта расхода — рекламная, выручка — своя: складывать их в одной
 * колонке нельзя, поэтому подписаны обе.
 */
const departmentColumns = (ad: string, own: string): TableColumn[] => [
  { key: 'name', label: 'Отдел' },
  { key: 'spend', label: `Расход, ${ad}`, align: 'right' as const },
  { key: 'leads', label: 'Лиды', align: 'right' as const },
  { key: 'cpl', label: `Цена лида, ${ad}`, align: 'right' as const },
  { key: 'sales', label: 'Продажи', align: 'right' as const },
  { key: 'revenue', label: `Выручка, ${own}`, align: 'right' as const },
  { key: 'roas', label: 'ROAS', align: 'right' as const },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    department?: string;
  }>;
}) {
  const { company } = await requireFullAccess();
  const currency = company.sales_currency;
  const params = await searchParams;
  const range = await currentRange(params, company.timezone);

  // Отдел из адреса: сводку по проекту можно смотреть и целиком, и по одному
  // отделу продаж — расход его кампаний против выручки его заявок.
  const departmentId = params.department ?? null;

  const [
    { totals, trend, creatives, hasAdData, spendSource, departments: departmentTotals },
    accountCurrency,
    departments,
  ] =
    await Promise.all([
      getDashboardData(company.id, range.from, range.to, company.timezone, departmentId),
      getAdSpendCurrency(company.id),
      getDepartments(company.id),
    ]);

  const activeDepartments = departments.filter((row) => row.status === 'active');

  // Правило то же, что в «Рекламе»: деньги площадки — в её валюте, деньги
  // бизнеса — в валюте продаж. Одно на все разделы, чтобы не разъезжалось.
  const view = moneyView(company.currency, currency, accountCurrency);
  const spendRow = { spend: totals.spend, spendSource };
  const adSpend = view.spendOf(spendRow);
  const otherSpend = view.otherSpendOf(spendRow);

  // Промежуточный шаг воронки зависит от типа бизнеса: пробное занятие
  // у школы, «взято в работу» у прямых продаж.
  const funnelType = company.funnel_type as FunnelType;
  const funnel = funnelLabels(funnelType, company.trial_term);
  const middle = middleStepValue(funnelType, totals);

  return (
    <>
      <PageHeader
        title="Главная"
        description={`Сводка по компании «${company.name}» за ${range.label}.`}
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        {!hasAdData ? (
          <div className="mb-6">
            <EmptyState
              icon={<IconAds className="size-5" />}
              title="Рекламные данные пока не подключены"
              description="Подключите рекламный кабинет Meta Ads или TikTok Ads — расход, показы и лиды начнут поступать автоматически."
              action={
                <ButtonLink href="/dashboard/integrations">
                  Подключить рекламный аккаунт
                </ButtonLink>
              }
            />
          </div>
        ) : null}

        <DepartmentFilter departments={activeDepartments} selected={departmentId} />

        {/* KPI-строка: расход и выручка — главные числа, поэтому выделены */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Расход"
            value={formatMoney(adSpend, { currency: view.adCurrency })}
            hint={
              view.showBoth
                ? formatMoney(otherSpend, { currency: view.otherCurrency })
                : undefined
            }
          />
          <StatTile
            label="Лиды"
            value={formatNumber(totals.leads)}
            hint={`Клики: ${formatNumber(totals.clicks)}`}
          />
          <StatTile
            label="CPL"
            value={
              totals.leads
                ? formatMoney(adSpend / totals.leads, { currency: view.adCurrency })
                : '—'
            }
            hint={
              view.showBoth && totals.leads
                ? formatMoney(otherSpend / totals.leads, { currency: view.otherCurrency })
                : undefined
            }
          />
          <StatTile label={funnel.middleColumn} value={formatNumber(middle)} />
          <StatTile
            label="Продажи"
            value={formatNumber(totals.sales)}
            hint={`Конверсия из лида: ${formatPercent(totals.conversion)}`}
          />
          <StatTile
            label="Выручка"
            value={formatMoney(totals.revenue, { currency })}
            hint={`Средний чек: ${formatMoney(totals.averageCheck, { currency })}`}
          />
          <StatTile
            label="ROAS"
            value={formatRatio(totals.roas)}
            accent
            hint={`ROI: ${formatPercent(totals.roi, 0)}`}
          />
          <StatTile
            label="Прибыль"
            value={formatMoney(totals.profit, { currency })}
            hint={`CAC: ${formatMoney(totals.cac, { currency })}`}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Выручка и расход"
              subtitle="Обе величины в тенге и на одной шкале — без второй оси"
            />
            <TrendChart data={trend} currency={currency} />
          </Card>

          <Card>
            <CardHeader title="Воронка" subtitle={funnel.title} />
            <Funnel
              steps={[
                { label: 'Лиды', value: totals.leads },
                { label: funnel.middleStep, value: middle },
                { label: 'Продажи', value: totals.sales },
              ]}
            />
          </Card>
        </div>

        {departmentTotals.length > 0 ? (
          <Card className="mt-4">
            <CardHeader
              title="Отделы продаж"
              subtitle="У каждого свои кампании и свой бюджет — итог выше складывается из них"
            />
            <TableShell
              columns={departmentColumns(currencySymbol(view.adCurrency), currencySymbol(currency))}
              minWidth={{ base: 640, md: 860 }}
            >
              {departmentTotals.map((row) => {
                const spend = view.spendOf(row);

                return (
                  <tr key={row.id} className="transition-colors hover:bg-surface-2/60">
                    <Td first truncate="md" title={row.name} className="font-medium text-ink">
                      {row.name}
                    </Td>
                    <Td align="right" className="tabular text-ink">
                      {formatNumber(spend, 2)}
                    </Td>
                    <Td align="right" className="tabular text-ink">
                      {formatNumber(row.leads)}
                    </Td>
                    <Td align="right" className="tabular text-ink">
                      {row.leads ? formatNumber(spend / row.leads, 2) : '—'}
                    </Td>
                    <Td align="right" className="tabular text-ink">
                      {formatNumber(row.sales)}
                    </Td>
                    <Td align="right" className="tabular font-medium text-ink">
                      {formatNumber(row.revenue)}
                    </Td>
                    <Td last align="right" className="tabular text-ink-soft">
                      {row.spend ? formatRatio(row.revenue / row.spend) : '—'}
                    </Td>
                  </tr>
                );
              })}
            </TableShell>
          </Card>
        ) : null}

        <Card className="mt-4">
          <CardHeader
            title="Эффективность креативов"
            subtitle="Отсортировано по выручке — дешёвый лид ещё не значит хорошая реклама"
            action={
              <ButtonLink href="/dashboard/creatives" variant="secondary" size="sm">
                Все креативы
              </ButtonLink>
            }
          />
          {creatives.length > 0 ? (
            <CreativeTable
              creatives={creatives}
              funnelType={funnelType}
              trialTerm={company.trial_term}
              currency={currency}
              adCurrency={view.adCurrency}
              spendOf={view.spendOf}
              limit={5}
            />
          ) : (
            <p className="px-6 py-10 text-center text-sm text-muted">
              За выбранный период по креативам нет данных.
            </p>
          )}
        </Card>
      </PageBody>
    </>
  );
}
