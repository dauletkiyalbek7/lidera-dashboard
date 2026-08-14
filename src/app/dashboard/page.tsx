import type { Metadata } from 'next';

import { CreativeTable } from '@/components/app/creative-table';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Funnel } from '@/components/charts/funnel';
import { TrendChart } from '@/components/charts/trend-chart';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAds } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireFullAccess } from '@/lib/auth';
import { formatMoney, formatNumber, formatPercent, formatRatio } from '@/lib/format';
import { FUNNEL_LABELS, middleStepValue, type FunnelType } from '@/lib/metrics';
import { resolveRange } from '@/lib/period';
import { getDashboardData } from '@/lib/queries';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireFullAccess();
  const currency = company.currency;
  const range = resolveRange(await searchParams, company.timezone);
  const { totals, trend, creatives, hasAdData } = await getDashboardData(
    company.id,
    range.from,
    range.to,
  );

  // Промежуточный шаг воронки зависит от типа бизнеса: пробное занятие
  // у школы, «взято в работу» у прямых продаж.
  const funnelType = company.funnel_type as FunnelType;
  const funnel = FUNNEL_LABELS[funnelType];
  const middle = middleStepValue(funnelType, totals);

  return (
    <>
      <PageHeader
        title="Dashboard"
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

        {/* KPI-строка: расход и выручка — главные числа, поэтому выделены */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Расход" value={formatMoney(totals.spend, { currency })} />
          <StatTile
            label="Лиды"
            value={formatNumber(totals.leads)}
            hint={`Клики: ${formatNumber(totals.clicks)}`}
          />
          <StatTile label="CPL" value={formatMoney(totals.cpl, { currency })} />
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
            <CreativeTable creatives={creatives} funnelType={funnelType} currency={currency} limit={5} />
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
