import type { Metadata } from 'next';

import { CreativeTable } from '@/components/app/creative-table';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { PeriodTabs } from '@/components/app/period-tabs';
import { Funnel } from '@/components/charts/funnel';
import { TrendChart } from '@/components/charts/trend-chart';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAds } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatMoney, formatNumber, formatPercent, formatRatio } from '@/lib/format';
import { resolvePeriod } from '@/lib/period';
import { getDashboardData } from '@/lib/queries';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { company } = await requireCompanySession();
  const params = await searchParams;
  const period = resolvePeriod(params.period);
  const { totals, trend, creatives, hasAdData } = await getDashboardData(
    company.id,
    period.from,
    period.to,
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Сводка по компании «${company.name}» за последние ${period.label}.`}
        action={<PeriodTabs active={period.key} />}
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

        {/* KPI-строка: расход и выручка — главные числа, поэтому выделены */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Расход" value={formatMoney(totals.spend)} />
          <StatTile
            label="Лиды"
            value={formatNumber(totals.leads)}
            hint={`Клики: ${formatNumber(totals.clicks)}`}
          />
          <StatTile label="CPL" value={formatMoney(totals.cpl)} />
          <StatTile label="Пробные" value={formatNumber(totals.trials)} />
          <StatTile
            label="Продажи"
            value={formatNumber(totals.sales)}
            hint={`Конверсия из лида: ${formatPercent(totals.conversion)}`}
          />
          <StatTile
            label="Выручка"
            value={formatMoney(totals.revenue)}
            hint={`Средний чек: ${formatMoney(totals.averageCheck)}`}
          />
          <StatTile
            label="ROAS"
            value={formatRatio(totals.roas)}
            accent
            hint={`ROI: ${formatPercent(totals.roi, 0)}`}
          />
          <StatTile
            label="Прибыль"
            value={formatMoney(totals.profit)}
            hint={`CAC: ${formatMoney(totals.cac)}`}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Выручка и расход"
              subtitle="Обе величины в тенге и на одной шкале — без второй оси"
            />
            <TrendChart data={trend} />
          </Card>

          <Card>
            <CardHeader title="Воронка" subtitle="От лида до продажи" />
            <Funnel
              steps={[
                { label: 'Лиды', value: totals.leads },
                { label: 'Пробные проведены', value: totals.trials },
                { label: 'Продажи', value: totals.sales },
              ]}
            />
          </Card>
        </div>

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
            <CreativeTable creatives={creatives} limit={5} />
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
