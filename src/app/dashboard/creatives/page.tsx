import type { Metadata } from 'next';

import { trialWords } from '@/lib/trial-term';
import Link from 'next/link';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Td, TableShell } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconCreatives } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireAdsAccess } from '@/lib/auth';
import {
  currencySymbol,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
} from '@/lib/format';
import { moneyView } from '@/lib/money-view';
import { resolveRange } from '@/lib/period';
import { getAdSpendCurrency, getCreativeCards } from '@/lib/queries';

export const metadata: Metadata = { title: 'Креативы' };


/** Валюта живёт в шапке колонки: расход в одной, выручка в другой. */
const baseColumns = (ad: string, own: string, middle: string) => [
  { key: 'creative', label: 'Креатив' },
  { key: 'spend', label: `Расход, ${ad}`, align: 'right' as const },
  { key: 'ctr', label: 'CTR', align: 'right' as const },
  { key: 'leads', label: 'Лиды', align: 'right' as const },
  { key: 'cpl', label: `Цена лида, ${ad}`, align: 'right' as const },
  { key: 'trials', label: middle, align: 'right' as const },
  { key: 'sales', label: 'Продажи', align: 'right' as const },
  { key: 'revenue', label: `Выручка, ${own}`, align: 'right' as const },
  { key: 'roas', label: 'ROAS', align: 'right' as const },
  { key: 'profit', label: `Прибыль, ${own}`, align: 'right' as const },
];

/** Без пробных занятий столбец не нужен — воронка короче. */
const columnsFor = (funnelType: string, ad: string, own: string, term: unknown) =>
  funnelType === 'trial'
    ? baseColumns(ad, own, trialWords(term).column)
    : baseColumns(ad, own, '').filter((c) => c.key !== 'trials');

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireAdsAccess();
  // Выручка и прибыль — деньги компании; расход показываем так же, как в
  // «Рекламе»: в выбранной валюте, со второй мелкой подписью.
  const currency = company.sales_currency;
  const range = resolveRange(await searchParams, company.timezone);

  const [cards, accountCurrency] = await Promise.all([
    getCreativeCards(company.id, range.from, range.to, company.timezone),
    getAdSpendCurrency(company.id),
  ]);

  // Показываем только то, что за период работало: тратило бюджет или приводило
  // людей. Креатив, который не крутился, в отчёте за этот период не при чём.
  const shown = cards.filter((card) => card.spend > 0 || card.conversions > 0);

  const conversions = shown.reduce((total, card) => total + card.conversions, 0);
  const cheapest = [...shown]
    .filter((card) => card.conversions > 0)
    .sort((a, b) => a.costPerConversion - b.costPerConversion)[0];

  // Расход в выбранной рекламной валюте, вторая — подписью рядом.
  const view = moneyView(company.currency, currency, accountCurrency);
  const { adCurrency, otherCurrency, showBoth } = view;
  const adMoney = (card: { spend: number; spendSource: number | null }) => view.spendOf(card);

  const adSpend = shown.reduce((total, card) => total + adMoney(card), 0);
  const otherSpend = shown.reduce((total, card) => total + view.otherSpendOf(card), 0);

  return (
    <>
      <PageHeader
        title="Креативы"
        description="Что крутилось за период: расход, лиды, выручка и отдача. Нажмите на строку — откроется сам ролик."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        {shown.length === 0 ? (
          <EmptyState
            icon={<IconCreatives className="size-5" />}
            title="За этот период креативы не крутились"
            description={
              cards.length > 0
                ? 'В кабинете креативы есть, но за выбранные даты они не тратили бюджет. Возьмите период шире.'
                : 'Креативы подтянутся из рекламного кабинета при ближайшей синхронизации — вместе с видео и обложками.'
            }
            action={<ButtonLink href="/dashboard/ads">Перейти в «Рекламу»</ButtonLink>}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Креативов работало"
                value={formatNumber(shown.length)}
                hint={`Всего в кабинете: ${formatNumber(cards.length)}`}
              />
              <StatTile
                label="Расход за период"
                value={formatMoney(adSpend, { currency: adCurrency })}
                hint={
                  showBoth
                    ? `${formatMoney(otherSpend, { currency: otherCurrency })} · лидов: ${formatNumber(conversions)}`
                    : `Лидов: ${formatNumber(conversions)}`
                }
              />
              <StatTile
                label="Самый дешёвый"
                value={
                  cheapest
                    ? formatMoney(adMoney(cheapest) / cheapest.conversions, {
                        currency: adCurrency,
                      })
                    : '—'
                }
                hint={cheapest ? cheapest.label : 'Пока не с чем сравнивать'}
                accent
              />
            </div>

            <Card className="mt-4">
              <CardHeader
                title="Список креативов"
                subtitle={`Отсортированы по расходу за ${range.label}. Нажмите строку — откроется ролик`}
              />
              <TableShell columns={columnsFor(
                  company.funnel_type,
                  currencySymbol(adCurrency),
                  currencySymbol(currency),
                  company.trial_term,
                )} minWidth={1080}>
                {shown.map((card) => {
                  const href = `/dashboard/creatives/${card.id}?${new URLSearchParams({
                    period: range.preset ?? '',
                    from: range.from,
                    to: range.to,
                  })}`;
                  const profit = card.revenue ? card.revenue - card.spend : 0;

                  return (
                    <tr key={card.id} className="transition-colors hover:bg-surface-2/60">
                      <Td first>
                        <Link href={href} className="flex items-center gap-3">
                          <span className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-surface-2">
                            {card.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={card.thumbnailUrl}
                                alt=""
                                className="size-full object-contain"
                                loading="lazy"
                              />
                            ) : (
                              <IconCreatives className="size-4 text-faint" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="whitespace-nowrap text-[14px] font-medium text-ink">
                                {card.label}
                              </span>
                              {card.status === 'active' ? (
                                <Badge tone="positive">Активен</Badge>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block max-w-[220px] truncate text-[12px] text-faint">
                              {card.campaigns[0] ?? 'Без кампании'}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td align="right" className="tabular text-ink">
                        {formatNumber(adMoney(card), 2)}
                      </Td>
                      <Td align="right" className="tabular text-ink-soft">
                        {formatPercent(card.ctr, 2)}
                      </Td>
                      <Td align="right" className="tabular font-medium text-lime">
                        {formatNumber(card.conversions)}
                      </Td>
                      <Td align="right" className="tabular text-ink">
                        {card.conversions
                          ? formatNumber(adMoney(card) / card.conversions, 2)
                          : '—'}
                      </Td>
                      {company.funnel_type === 'trial' ? (
                        <Td align="right" className="tabular text-ink-soft">
                          {card.trials ? formatNumber(card.trials) : '—'}
                        </Td>
                      ) : null}
                      <Td align="right" className="tabular text-ink-soft">
                        {card.sales ? formatNumber(card.sales) : '—'}
                      </Td>
                      <Td align="right" className="tabular text-ink">
                        {card.revenue ? formatNumber(card.revenue, 0) : '—'}
                      </Td>
                      <Td align="right" className="tabular text-ink-soft">
                        {card.revenue && card.spend
                          ? `×${formatRatio(card.revenue / card.spend)}`
                          : '—'}
                      </Td>
                      <Td
                        last
                        align="right"
                        className={`tabular ${profit > 0 ? 'text-positive' : profit < 0 ? 'text-negative' : 'text-muted'}`}
                      >
                        {card.revenue ? formatNumber(profit, 0) : '—'}
                      </Td>
                    </tr>
                  );
                })}
              </TableShell>
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
