import type { Metadata } from 'next';
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
import { requireCompanySession } from '@/lib/auth';
import { formatMoney, formatNumber, formatPercent, formatRatio } from '@/lib/format';
import { resolveRange } from '@/lib/period';
import { getCreativeCards } from '@/lib/queries';

export const metadata: Metadata = { title: 'Креативы' };

const BASE_COLUMNS = [
  { key: 'creative', label: 'Креатив' },
  { key: 'spend', label: 'Расход', align: 'right' as const },
  { key: 'ctr', label: 'CTR', align: 'right' as const },
  { key: 'leads', label: 'Лиды', align: 'right' as const },
  { key: 'cpl', label: 'Цена лида', align: 'right' as const },
  { key: 'trials', label: 'Пробные', align: 'right' as const },
  { key: 'sales', label: 'Продажи', align: 'right' as const },
  { key: 'revenue', label: 'Выручка', align: 'right' as const },
  { key: 'roas', label: 'ROAS', align: 'right' as const },
  { key: 'profit', label: 'Прибыль', align: 'right' as const },
];

/** Без пробных занятий столбец не нужен — воронка короче. */
const columnsFor = (funnelType: string) =>
  funnelType === 'trial' ? BASE_COLUMNS : BASE_COLUMNS.filter((c) => c.key !== 'trials');

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();
  const currency = company.currency;
  const range = resolveRange(await searchParams, company.timezone);

  const cards = await getCreativeCards(company.id, range.from, range.to);

  // Показываем только то, что за период работало: тратило бюджет или приводило
  // людей. Креатив, который не крутился, в отчёте за этот период не при чём.
  const shown = cards.filter((card) => card.spend > 0 || card.conversions > 0);

  const spend = shown.reduce((total, card) => total + card.spend, 0);
  const conversions = shown.reduce((total, card) => total + card.conversions, 0);
  const cheapest = [...shown]
    .filter((card) => card.conversions > 0)
    .sort((a, b) => a.costPerConversion - b.costPerConversion)[0];

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
                value={formatMoney(spend, { currency })}
                hint={`Лидов: ${formatNumber(conversions)}`}
              />
              <StatTile
                label="Самый дешёвый"
                value={cheapest ? formatMoney(cheapest.costPerConversion, { currency }) : '—'}
                hint={cheapest ? cheapest.label : 'Пока не с чем сравнивать'}
                accent
              />
            </div>

            <Card className="mt-4">
              <CardHeader
                title="Список креативов"
                subtitle={`Отсортированы по расходу за ${range.label}. Нажмите строку — откроется ролик`}
              />
              <TableShell columns={columnsFor(company.funnel_type)} minWidth={1080}>
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
                        {formatMoney(card.spend, { currency })}
                      </Td>
                      <Td align="right" className="tabular text-ink-soft">
                        {formatPercent(card.ctr, 2)}
                      </Td>
                      <Td align="right" className="tabular font-medium text-lime">
                        {formatNumber(card.conversions)}
                      </Td>
                      <Td align="right" className="tabular text-ink">
                        {card.conversions
                          ? formatMoney(card.costPerConversion, { currency })
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
                        {card.revenue ? formatMoney(card.revenue, { currency }) : '—'}
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
                        {card.revenue ? formatMoney(profit, { currency }) : '—'}
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
