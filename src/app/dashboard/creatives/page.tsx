import type { Metadata } from 'next';
import Link from 'next/link';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconArrowRight, IconCreatives } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { resolveRange } from '@/lib/period';
import { getCreativeCards } from '@/lib/queries';

export const metadata: Metadata = { title: 'Креативы' };

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();
  const currency = company.currency;
  const range = resolveRange(await searchParams);

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
        description="Что крутилось за период: расход, сколько людей привёл и почём. Нажмите на строку — откроется сам ролик."
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
                hint={`Написали: ${formatNumber(conversions)}`}
              />
              <StatTile
                label="Самый дешёвый"
                value={cheapest ? formatMoney(cheapest.costPerConversion, { currency }) : '—'}
                hint={cheapest ? cheapest.title || cheapest.name : 'Пока не с чем сравнивать'}
                accent
              />
            </div>

            <Card className="mt-4">
              <CardHeader
                title="Список креативов"
                subtitle={`Отсортированы по расходу за ${range.label}`}
              />
              <ul className="divide-y divide-line">
                {shown.map((card) => (
                  <li key={card.id}>
                    <Link
                      href={`/dashboard/creatives/${card.id}?${new URLSearchParams({
                        period: range.preset ?? '',
                        from: range.from,
                        to: range.to,
                      })}`}
                      className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2/60 sm:px-6"
                    >
                      <span className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-surface-2">
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

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[14px] font-medium text-ink">
                            {card.title || card.name}
                          </span>
                          {card.hasVideo ? <Badge tone="neutral">Видео</Badge> : null}
                          {card.status === 'active' ? (
                            <Badge tone="positive">Активен</Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-faint">
                          {card.campaigns.slice(0, 2).join(', ') || 'Без кампании'}
                          {card.numbers.length > 0 ? ` · ${card.numbers.join(', ')}` : ''}
                        </span>
                      </span>

                      <span className="hidden shrink-0 text-right sm:block">
                        <span className="tabular block text-[14px] text-ink">
                          {formatMoney(card.spend, { currency })}
                        </span>
                        <span className="block text-[11.5px] text-faint">расход</span>
                      </span>

                      <span className="shrink-0 text-right">
                        <span className="tabular block text-[14px] font-medium text-lime">
                          {formatNumber(card.conversions)}
                        </span>
                        <span className="block text-[11.5px] text-faint">написали</span>
                      </span>

                      <span className="hidden shrink-0 text-right md:block">
                        <span className="tabular block text-[14px] text-ink">
                          {card.conversions
                            ? formatMoney(card.costPerConversion, { currency })
                            : '—'}
                        </span>
                        <span className="block text-[11.5px] text-faint">цена</span>
                      </span>

                      <span className="hidden shrink-0 text-right lg:block">
                        <span className="tabular block text-[14px] text-ink">
                          {formatNumber(card.clicks)}
                        </span>
                        <span className="block text-[11.5px] text-faint">
                          CTR {formatPercent(card.ctr, 2)}
                        </span>
                      </span>

                      <IconArrowRight className="size-4 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
