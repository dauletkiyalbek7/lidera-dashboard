import type { Metadata } from 'next';

import { CreativeCard } from '@/components/app/creative-card';
import { CreativeTable } from '@/components/app/creative-table';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconCreatives } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatMoney, formatNumber } from '@/lib/format';
import type { FunnelType } from '@/lib/metrics';
import { resolveRange } from '@/lib/period';
import { getCreativeCards, getDashboardData } from '@/lib/queries';

export const metadata: Metadata = { title: 'Креативы' };

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();
  const currency = company.currency;
  const range = resolveRange(await searchParams);
  const funnelType = company.funnel_type as FunnelType;

  const [cards, { creatives }] = await Promise.all([
    getCreativeCards(company.id, range.from, range.to),
    getDashboardData(company.id, range.from, range.to),
  ]);

  // Показываем работающие: те, что крутились за период, и все активные.
  // Архив и старые паузы только мешают смотреть.
  const running = cards.filter(
    (card) => card.spend > 0 || card.conversions > 0 || card.status === 'active',
  );
  const shown = running.length > 0 ? running : cards;

  const spend = shown.reduce((total, card) => total + card.spend, 0);
  const conversions = shown.reduce((total, card) => total + card.conversions, 0);
  const cheapest = [...shown]
    .filter((card) => card.conversions > 0)
    .sort((a, b) => a.costPerConversion - b.costPerConversion)[0];

  return (
    <>
      <PageHeader
        title="Креативы"
        description="Сам ролик и его цифры рядом: сколько стоил, сколько людей привёл и почём."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        {cards.length === 0 ? (
          <EmptyState
            icon={<IconCreatives className="size-5" />}
            title="Креативов пока нет"
            description="Креативы подтянутся из рекламного кабинета при ближайшей синхронизации — вместе с видео и обложками."
            action={
              <ButtonLink href="/dashboard/ads">Перейти в раздел «Реклама»</ButtonLink>
            }
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Креативов в работе"
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
                value={
                  cheapest ? formatMoney(cheapest.costPerConversion, { currency }) : '—'
                }
                hint={cheapest ? `${cheapest.title || cheapest.name}` : 'Пока не с чем сравнивать'}
                accent
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((card) => (
                <CreativeCard key={card.id} creative={card} currency={currency} />
              ))}
            </div>

            {creatives.length > 0 ? (
              <Card className="mt-4">
                <CardHeader
                  title="Сквозная аналитика"
                  subtitle={`Путь от креатива до денег за ${range.label}`}
                />
                <CreativeTable
                  creatives={creatives}
                  funnelType={funnelType}
                  currency={currency}
                />
              </Card>
            ) : null}
          </>
        )}
      </PageBody>
    </>
  );
}
