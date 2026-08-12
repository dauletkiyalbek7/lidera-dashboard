import type { Metadata } from 'next';

import { CreativeTable } from '@/components/app/creative-table';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { PeriodTabs } from '@/components/app/period-tabs';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconCreatives } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatMoney, formatRatio } from '@/lib/format';
import { resolvePeriod } from '@/lib/period';
import { getDashboardData } from '@/lib/queries';

export const metadata: Metadata = { title: 'Креативы' };

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { company } = await requireCompanySession();
  const period = resolvePeriod((await searchParams).period);
  const { creatives } = await getDashboardData(company.id, period.from, period.to);

  const best = creatives[0];
  const worst = [...creatives].sort((a, b) => a.roas - b.roas)[0];
  const wasted = creatives
    .filter((creative) => creative.roas < 1)
    .reduce((total, creative) => total + creative.spend, 0);

  return (
    <>
      <PageHeader
        title="Креативы"
        description="Лучшие и худшие креативы по деньгам, а не по количеству заявок."
        action={<PeriodTabs active={period.key} />}
      />

      <PageBody>
        {creatives.length === 0 ? (
          <EmptyState
            icon={<IconCreatives className="size-5" />}
            title="Креативов пока нет"
            description="Креативы подтянутся из рекламных кабинетов Meta Ads и TikTok Ads после подключения."
            action={
              <ButtonLink href="/dashboard/integrations">
                Подключить рекламный аккаунт
              </ButtonLink>
            }
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Лучший креатив"
                value={best?.name ?? '—'}
                accent
                hint={best ? `ROAS ${formatRatio(best.roas)} · ${formatMoney(best.revenue)}` : undefined}
              />
              <StatTile
                label="Худший креатив"
                value={worst?.name ?? '—'}
                hint={worst ? `ROAS ${formatRatio(worst.roas)} · ${formatMoney(worst.spend)} расхода` : undefined}
              />
              <StatTile
                label="Расход на убыточные"
                value={formatMoney(wasted)}
                hint="Креативы с ROAS ниже 1 — реклама не окупается"
              />
            </div>

            <Card className="mt-4">
              <CardHeader
                title="Сквозная аналитика креативов"
                subtitle={`Расход, лиды, пробные, продажи и выручка за ${period.label}`}
              />
              <CreativeTable creatives={creatives} />
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
