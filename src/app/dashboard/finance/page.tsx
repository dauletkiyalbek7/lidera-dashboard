import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { PeriodTabs } from '@/components/app/period-tabs';
import { TrendChart } from '@/components/charts/trend-chart';
import { Card, CardHeader } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatMoney, formatPercent, formatRatio } from '@/lib/format';
import { resolvePeriod } from '@/lib/period';
import { getDashboardData, getSubscription } from '@/lib/queries';
import { PLAN_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Финансы' };

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { company } = await requireCompanySession();
  const period = resolvePeriod((await searchParams).period);

  const [{ totals, trend }, subscription] = await Promise.all([
    getDashboardData(company.id, period.from, period.to),
    getSubscription(company.id),
  ]);

  return (
    <>
      <PageHeader
        title="Финансы"
        description="Расход, выручка и окупаемость рекламы за выбранный период."
        action={<PeriodTabs active={period.key} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Рекламный расход" value={formatMoney(totals.spend)} />
          <StatTile label="Выручка" value={formatMoney(totals.revenue)} />
          <StatTile
            label="Прибыль до прочих расходов"
            value={formatMoney(totals.profit)}
            accent
          />
          <StatTile
            label="ROAS"
            value={formatRatio(totals.roas)}
            hint={`ROI: ${formatPercent(totals.roi, 0)}`}
          />
          <StatTile label="CPL" value={formatMoney(totals.cpl)} />
          <StatTile label="CAC" value={formatMoney(totals.cac)} />
          <StatTile label="Средний чек" value={formatMoney(totals.averageCheck)} />
          <StatTile
            label="Конверсия лид → продажа"
            value={formatPercent(totals.conversion)}
          />
        </div>

        <Card className="mt-4">
          <CardHeader
            title="Выручка и расход по дням"
            subtitle="Одна шкала в тенге: разрыв между линиями — это ваша прибыль"
          />
          <TrendChart data={trend} />
        </Card>

        <Card className="mt-4">
          <CardHeader title="Тариф" subtitle="Биллинг подключается на следующем этапе" />
          <dl className="grid gap-px bg-line sm:grid-cols-3">
            <div className="bg-surface px-5 py-4 sm:px-6">
              <dt className="text-[12.5px] text-muted">План</dt>
              <dd className="mt-1.5 text-[15px] font-medium text-ink">
                {subscription ? (PLAN_LABELS[subscription.plan] ?? subscription.plan) : '—'}
              </dd>
            </div>
            <div className="bg-surface px-5 py-4 sm:px-6">
              <dt className="text-[12.5px] text-muted">Статус</dt>
              <dd className="mt-1.5 text-[15px] font-medium text-ink">
                {subscription?.status === 'active' ? 'Активен' : (subscription?.status ?? '—')}
              </dd>
            </div>
            <div className="bg-surface px-5 py-4 sm:px-6">
              <dt className="text-[12.5px] text-muted">Действует с</dt>
              <dd className="tabular mt-1.5 text-[15px] font-medium text-ink">
                {subscription?.start_date ?? '—'}
              </dd>
            </div>
          </dl>
        </Card>
      </PageBody>
    </>
  );
}
