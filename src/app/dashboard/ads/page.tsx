import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { PeriodTabs } from '@/components/app/period-tabs';
import { Td, TableShell } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAds } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatDate, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { INTEGRATION_STATUS, PLATFORM_LABELS, statusOf } from '@/lib/labels';
import { resolvePeriod } from '@/lib/period';
import { getAdAccounts, getCampaigns, getDashboardData } from '@/lib/queries';

export const metadata: Metadata = { title: 'Реклама' };

const CAMPAIGN_COLUMNS = [
  { key: 'name', label: 'Кампания' },
  { key: 'platform', label: 'Площадка' },
  { key: 'objective', label: 'Цель' },
  { key: 'status', label: 'Статус' },
  { key: 'created', label: 'Создана', align: 'right' as const },
];

const CAMPAIGN_STATUS: Record<string, { label: string; tone: 'positive' | 'neutral' | 'warning' }> = {
  active: { label: 'Активна', tone: 'positive' },
  paused: { label: 'На паузе', tone: 'warning' },
  archived: { label: 'В архиве', tone: 'neutral' },
};

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { company } = await requireCompanySession();
  const period = resolvePeriod((await searchParams).period);

  const [accounts, campaigns, { totals }] = await Promise.all([
    getAdAccounts(company.id),
    getCampaigns(company.id),
    getDashboardData(company.id, period.from, period.to),
  ]);

  if (accounts.length === 0 && campaigns.length === 0) {
    return (
      <>
        <PageHeader title="Реклама" description="Meta Ads и TikTok Ads в одном окне." />
        <PageBody>
          <EmptyState
            icon={<IconAds className="size-5" />}
            title="Рекламные данные пока не подключены"
            description="Подключите рекламный кабинет — кампании, группы объявлений, объявления и креативы загрузятся автоматически."
            action={
              <ButtonLink href="/dashboard/integrations">
                Подключить рекламный аккаунт
              </ButtonLink>
            }
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Реклама"
        description="Расход, показы и клики из подключённых рекламных кабинетов."
        action={<PeriodTabs active={period.key} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Расход" value={formatMoney(totals.spend)} />
          <StatTile label="Показы" value={formatNumber(totals.impressions)} />
          <StatTile
            label="Клики"
            value={formatNumber(totals.clicks)}
            hint={`CTR: ${formatPercent(totals.ctr, 2)}`}
          />
          <StatTile
            label="CPC"
            value={formatMoney(totals.cpc)}
            hint={`CPM: ${formatMoney(totals.cpm)}`}
          />
        </div>

        <Card className="mt-4">
          <CardHeader title="Рекламные кабинеты" subtitle="Подключение и статус синхронизации" />
          {accounts.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted">
              Кабинеты ещё не подключены.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {accounts.map((account) => {
                const status = statusOf(INTEGRATION_STATUS, account.status);
                return (
                  <li
                    key={account.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-ink">
                        {account.account_name}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-faint">
                        {PLATFORM_LABELS[account.platform] ?? account.platform}
                        {account.account_id ? ` · ${account.account_id}` : ''}
                      </p>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="mt-4">
          <CardHeader title="Кампании" subtitle={`Всего: ${formatNumber(campaigns.length)}`} />
          {campaigns.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted">Кампаний пока нет.</p>
          ) : (
            <TableShell columns={CAMPAIGN_COLUMNS} minWidth={760}>
              {campaigns.map((campaign) => {
                const status = CAMPAIGN_STATUS[campaign.status] ?? {
                  label: campaign.status,
                  tone: 'neutral' as const,
                };
                return (
                  <tr key={campaign.id} className="transition-colors hover:bg-surface-2/60">
                    <Td first className="font-medium text-ink">
                      {campaign.name}
                    </Td>
                    <Td className="text-ink-soft">
                      {PLATFORM_LABELS[campaign.platform] ?? campaign.platform}
                    </Td>
                    <Td className="text-ink-soft">{campaign.objective ?? '—'}</Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td last align="right" className="tabular text-muted">
                      {formatDate(campaign.created_at)}
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
