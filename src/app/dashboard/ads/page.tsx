import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Td, TableShell } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAds } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import {
  currencySymbol,
  formatDateShort,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
} from '@/lib/format';
import { INTEGRATION_STATUS, PLATFORM_LABELS, statusOf } from '@/lib/labels';
import { resolveRange } from '@/lib/period';
import {
  getAdAccounts,
  getAdBreakdown,
  getCampaigns,
  getCurrencyNote,
} from '@/lib/queries';
import { SyncMetaButton } from '@/app/dashboard/integrations/sync-button';
import { CampaignToggle } from './campaign-toggle';

export const metadata: Metadata = { title: 'Реклама' };

const CAMPAIGN_COLUMNS = [
  { key: 'name', label: 'Кампания' },
  { key: 'number', label: 'Номер' },
  { key: 'status', label: 'Статус' },
  { key: 'spend', label: 'Расход', align: 'right' as const },
  { key: 'conversions', label: 'Лиды', align: 'right' as const },
  { key: 'cost', label: 'Цена', align: 'right' as const },
  { key: 'revenue', label: 'Выручка', align: 'right' as const },
  { key: 'roas', label: 'ROAS', align: 'right' as const },
  { key: 'counted', label: 'В отчёте', align: 'right' as const },
];

const NUMBER_COLUMNS = [
  { key: 'number', label: 'Номер WhatsApp' },
  { key: 'spend', label: 'Расход', align: 'right' as const },
  { key: 'conversions', label: 'Лиды', align: 'right' as const },
  { key: 'cost', label: 'Цена лида', align: 'right' as const },
  { key: 'share', label: 'Доля расхода', align: 'right' as const },
];

const CAMPAIGN_STATUS: Record<string, { label: string; tone: 'positive' | 'neutral' | 'warning' }> = {
  active: { label: 'Активна', tone: 'positive' },
  paused: { label: 'На паузе', tone: 'warning' },
  archived: { label: 'В архиве', tone: 'neutral' },
};

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company, profile } = await requireCompanySession();
  const currency = company.currency;
  const range = resolveRange(await searchParams, company.timezone);

  const [accounts, campaigns, breakdown, currencyNote] = await Promise.all([
    getAdAccounts(company.id),
    getCampaigns(company.id),
    getAdBreakdown(company.id, range.from, range.to),
    getCurrencyNote(company.id, currency),
  ]);

  const { totals } = breakdown;

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
        description={
          currencyNote
            ? `Сколько потратили, сколько лидов получили и почём вышел один. Кабинет считает в ${currencySymbol(currencyNote.source)}, отчёт — в ${currencySymbol(currencyNote.target)} по курсу Нацбанка РК: 1 ${currencySymbol(currencyNote.source)} = ${formatNumber(currencyNote.rate, 2)} ${currencySymbol(currencyNote.target)} на ${formatDateShort(currencyNote.date)}.`
            : 'Сколько потратили, сколько лидов получили и почём вышел один.'
        }
        action={
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <SyncMetaButton disabled={profile.role !== 'DIRECTOR'} />
            <DateRangePicker range={range} />
          </div>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Расход"
            value={formatMoney(totals.spend, { currency })}
            hint={`За ${range.label}`}
          />
          <StatTile
            label="Лиды"
            value={formatNumber(totals.conversions)}
            hint="Заявки с сайта и написавшие в переписке — по данным Meta"
          />
          <StatTile
            label="Цена лида"
            value={formatMoney(totals.costPerConversion, { currency })}
            hint="Расход ÷ количество лидов"
            accent
          />
          <StatTile
            label="Клики"
            value={formatNumber(totals.clicks)}
            hint={`CTR ${formatPercent(totals.ctr, 2)} · CPC ${formatMoney(totals.cpc, { currency })}`}
          />
          <StatTile
            label="Выручка"
            value={totals.revenue ? formatMoney(totals.revenue, { currency }) : '—'}
            hint={
              totals.sales
                ? `Продаж: ${formatNumber(totals.sales)}`
                : 'Появится, когда продажи начнут отмечать в кабинете'
            }
          />
          <StatTile
            label="ROAS"
            value={totals.roas ? `×${formatRatio(totals.roas)}` : '—'}
            hint="Выручка ÷ расход"
          />
          <StatTile
            label="Прибыль"
            value={
              totals.revenue ? formatMoney(totals.revenue - totals.spend, { currency }) : '—'
            }
            hint={
              totals.revenue
                ? `ROMI ${formatPercent(((totals.revenue - totals.spend) / totals.spend) * 100, 0)}`
                : 'Выручка минус расход на рекламу'
            }
          />
        </div>

        {breakdown.numbers.length > 0 ? (
          <Card className="mt-4">
            <CardHeader
              title="Номера WhatsApp"
              subtitle="На какой номер сколько людей написало и во сколько это обошлось"
            />
            <TableShell columns={NUMBER_COLUMNS} minWidth={720}>
              {breakdown.numbers.map((row) => (
                <tr key={row.key} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="tabular font-medium text-ink">
                    {row.title}
                    {row.title.startsWith('…') ? (
                      <span className="ml-2 text-[11.5px] text-faint">
                        номер не задан в кабинете
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right" className="tabular text-ink">
                    {formatMoney(row.spend, { currency })}
                  </Td>
                  <Td align="right" className="tabular text-ink">
                    {formatNumber(row.conversions)}
                  </Td>
                  <Td align="right" className="tabular font-medium text-ink">
                    {row.conversions ? formatMoney(row.costPerConversion, { currency }) : '—'}
                  </Td>
                  <Td last align="right" className="tabular text-muted">
                    {totals.spend ? formatPercent((row.spend / totals.spend) * 100, 0) : '—'}
                  </Td>
                </tr>
              ))}
            </TableShell>
          </Card>
        ) : null}

        <Card className="mt-4">
          <CardHeader
            title="Кампании"
            subtitle={
              breakdown.campaigns.length
                ? `Те, что откручивались за ${range.label}. Выключите переключатель у кампаний найма — они перестанут влиять на итоги и цену лида`
                : 'За выбранный период открутки не было'
            }
          />
          {breakdown.campaigns.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted">
              Возьмите период шире — например «Последние 30 дней».
            </p>
          ) : (
            <TableShell columns={CAMPAIGN_COLUMNS} minWidth={1040}>
              {breakdown.campaigns.map((row) => {
                const status = row.status ? CAMPAIGN_STATUS[row.status] : null;
                return (
                  <tr
                    key={row.key}
                    className={`transition-colors hover:bg-surface-2/60 ${
                      row.counted === false ? 'opacity-55' : ''
                    }`}
                  >
                    <Td first className="font-medium text-ink">
                      {row.title}
                      {row.counted === false ? (
                        <span className="mt-0.5 block text-[11.5px] font-normal text-faint">
                          не входит в итоги
                        </span>
                      ) : null}
                    </Td>
                    <Td className="tabular text-ink-soft">{row.subtitle ?? '—'}</Td>
                    <Td>{status ? <Badge tone={status.tone}>{status.label}</Badge> : '—'}</Td>
                    <Td align="right" className="tabular text-ink">
                      {formatMoney(row.spend, { currency })}
                    </Td>
                    <Td align="right" className="tabular text-ink">
                      {formatNumber(row.conversions)}
                    </Td>
                    <Td align="right" className="tabular font-medium text-ink">
                      {row.conversions ? formatMoney(row.costPerConversion, { currency }) : '—'}
                    </Td>
                    <Td align="right" className="tabular text-ink-soft">
                      {row.revenue ? formatMoney(row.revenue, { currency }) : '—'}
                    </Td>
                    <Td align="right" className="tabular text-ink-soft">
                      {row.roas ? `×${formatRatio(row.roas)}` : '—'}
                    </Td>
                    <Td last align="right">
                      <span className="flex justify-end">
                        <CampaignToggle
                          campaignId={row.key}
                          counted={row.counted !== false}
                          disabled={profile.role !== 'DIRECTOR'}
                        />
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </TableShell>
          )}
        </Card>

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
      </PageBody>
    </>
  );
}
