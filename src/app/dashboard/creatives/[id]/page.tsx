import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CreativePlayer } from '@/components/app/creative-player';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { resolveRange } from '@/lib/period';
import { getCreativeCards } from '@/lib/queries';

export const metadata: Metadata = { title: 'Креатив' };

export default async function CreativePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();
  const currency = company.currency;
  const { id } = await params;
  const range = resolveRange(await searchParams, company.timezone);

  const cards = await getCreativeCards(company.id, range.from, range.to);
  const creative = cards.find((card) => card.id === id);

  if (!creative) notFound();

  const status =
    creative.status === 'active'
      ? { label: 'Активен', tone: 'positive' as const }
      : creative.status === 'paused'
        ? { label: 'На паузе', tone: 'warning' as const }
        : { label: 'В архиве', tone: 'neutral' as const };

  return (
    <>
      <PageHeader
        title={creative.title || creative.name}
        description={`Креатив за ${range.label}`}
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <Link
          href="/dashboard/creatives"
          className="inline-flex text-[13px] text-muted transition-colors hover:text-ink"
        >
          ← Все креативы
        </Link>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
          <div>
            <CreativePlayer
              creativeId={creative.id}
              thumbnailUrl={creative.thumbnailUrl}
              hasVideo={creative.hasVideo}
              name={creative.name}
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone={status.tone}>{status.label}</Badge>
              {creative.hasVideo ? <Badge tone="neutral">Видео</Badge> : null}
              {creative.numbers.map((number) => (
                <Badge key={number} tone="neutral">
                  {number}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatTile label="Расход" value={formatMoney(creative.spend, { currency })} />
              <StatTile
                label="Лиды"
                value={formatNumber(creative.conversions)}
                hint="Заявки и начатые переписки"
                accent
              />
              <StatTile
                label="Цена лида"
                value={
                  creative.conversions
                    ? formatMoney(creative.costPerConversion, { currency })
                    : '—'
                }
              />
              <StatTile
                label="Клики"
                value={formatNumber(creative.clicks)}
                hint={`CTR ${formatPercent(creative.ctr, 2)}`}
              />
              <StatTile label="Показы" value={formatNumber(creative.impressions)} />
              <StatTile
                label="Продажи"
                value={formatNumber(creative.sales)}
                hint={
                  creative.sales
                    ? formatMoney(creative.revenue, { currency })
                    : 'Появятся, когда продажи начнут попадать в CRM'
                }
              />
            </div>

            <Card>
              <CardHeader title="Объявление" subtitle="Текст, который видит человек" />
              <dl className="divide-y divide-line">
                <Row label="Заголовок" value={creative.title || '—'} />
                <Row label="Текст" value={creative.body || '—'} />
                <Row
                  label="Кампании"
                  value={creative.campaigns.join(', ') || 'Без кампании'}
                />
                <Row
                  label="Номера WhatsApp"
                  value={creative.numbers.join(', ') || 'Не задан в кабинете'}
                />
                <Row label="Формат" value={creative.hasVideo ? 'Видео' : 'Изображение'} />
              </dl>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-6">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink sm:max-w-[70%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}
