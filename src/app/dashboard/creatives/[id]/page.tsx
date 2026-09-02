import type { Metadata } from 'next';

import { trialWords } from '@/lib/trial-term';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CreativePlayer } from '@/components/app/creative-player';
import { CreativeRenameForm } from './rename-form';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';
import { requireAdsAccess } from '@/lib/auth';
import { formatDate, formatMoney, formatNumber, formatPercent, formatRatio } from '@/lib/format';
import { moneyView, per } from '@/lib/money-view';
import { currentRange } from '@/lib/period-preference';
import { getAdSpendCurrency, getCreativeBuyers, getCreativeCards } from '@/lib/queries';

export const metadata: Metadata = { title: 'Креатив' };

/** Кто купил с ролика: имя и сумма — главное, остальное по мере ширины. */
const buyerColumns = (currency: string): TableColumn[] => [
  { key: 'name', label: 'Клиент' },
  { key: 'phone', label: 'Телефон', showFrom: 'md' },
  { key: 'lead', label: 'Оставил заявку', showFrom: 'lg' },
  { key: 'date', label: 'Купил', showFrom: 'md' },
  { key: 'amount', label: `Сумма, ${currency}`, align: 'right' as const },
];

export default async function CreativePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company, profile } = await requireAdsAccess();
  // Выручка и прибыль — деньги компании; расход и всё, что от него считается,
  // показываем в выбранной рекламной валюте со второй строкой рядом.
  const currency = company.sales_currency;
  const { id } = await params;
  const range = await currentRange(await searchParams, company.timezone);

  const [cards, accountCurrency, buyers] = await Promise.all([
    getCreativeCards(company.id, range.from, range.to, company.timezone),
    getAdSpendCurrency(company.id),
    getCreativeBuyers(company.id, id, range.from, range.to, company.timezone),
  ]);

  const bought = buyers.reduce((total, buyer) => total + buyer.amount, 0);
  const creative = cards.find((card) => card.id === id);

  if (!creative) notFound();

  const view = moneyView(company.currency, currency, accountCurrency);
  const spend = view.spendOf(creative);
  const otherSpend = view.otherSpendOf(creative);
  const ad = { currency: view.adCurrency };
  /** Вторая строка под крупной цифрой: та же сумма в другой валюте. */
  const also = (value: number | null) =>
    view.showBoth && value !== null
      ? formatMoney(value, { currency: view.otherCurrency })
      : null;

  const status =
    creative.status === 'active'
      ? { label: 'Активен', tone: 'positive' as const }
      : creative.status === 'paused'
        ? { label: 'На паузе', tone: 'warning' as const }
        : { label: 'В архиве', tone: 'neutral' as const };

  return (
    <>
      <PageHeader
        title={creative.label}
        description={`${creative.title || creative.name} · за ${range.label}`}
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
              <StatTile
                label="Расход"
                value={formatMoney(spend, ad)}
                hint={also(otherSpend)}
              />
              <StatTile
                label="Лиды"
                value={formatNumber(creative.conversions)}
                hint="Заявки и начатые переписки"
                accent
              />
              <StatTile
                label="Цена лида"
                value={
                  creative.conversions ? formatMoney(spend / creative.conversions, ad) : '—'
                }
                hint={also(per(otherSpend, creative.conversions))}
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
                    ? `Выручка ${formatMoney(creative.revenue, { currency })}`
                    : 'Появятся, когда продажи начнут отмечать в кабинете'
                }
              />
              <StatTile
                label="ROAS"
                value={
                  creative.revenue && creative.spend
                    ? `×${formatRatio(creative.revenue / creative.spend)}`
                    : '—'
                }
                hint="Выручка ÷ расход"
              />
              <StatTile
                label="Прибыль"
                value={
                  creative.revenue
                    ? formatMoney(creative.revenue - creative.spend, { currency })
                    : '—'
                }
                hint={
                  creative.revenue && creative.spend
                    ? `ROMI ${formatPercent(((creative.revenue - creative.spend) / creative.spend) * 100, 0)}`
                    : 'Выручка минус расход на этот ролик'
                }
              />
              <StatTile
                label="Цена клиента"
                value={creative.sales ? formatMoney(spend / creative.sales, ad) : '—'}
                hint={
                  also(per(otherSpend, creative.sales)) ?? 'Расход ÷ количество продаж'
                }
              />
              <StatTile
                label="Из лида в клиента"
                value={
                  creative.conversions
                    ? formatPercent((creative.sales / creative.conversions) * 100, 1)
                    : '—'
                }
                hint="Сколько обращений дошло до покупки"
              />
              {company.funnel_type === 'trial' ? (
                <StatTile
                  label={trialWords(company.trial_term).section}
                  value={formatNumber(creative.trials)}
                  hint={
                    creative.conversions
                      ? `Дошли до этого шага: ${formatPercent((creative.trials / creative.conversions) * 100, 1)}`
                      : 'Состоявшиеся встречи по заявкам этого ролика'
                  }
                />
              ) : null}
              <StatTile
                label="Цена клика"
                value={creative.clicks ? formatMoney(spend / creative.clicks, ad) : '—'}
                hint={`1000 показов — ${
                  creative.impressions
                    ? formatMoney((spend / creative.impressions) * 1000, ad)
                    : '—'
                }${also(per(otherSpend, creative.clicks)) ? ` · клик ${also(per(otherSpend, creative.clicks))}` : ''}`}
              />
            </div>

            {creative.hasVideo ? (
              <Card>
                <CardHeader
                  title="Как смотрят ролик"
                  subtitle="Где человек теряет интерес — видно по досмотрам"
                />
                <dl className="divide-y divide-line">
                  <Row label="Начали смотреть" value={formatNumber(creative.videoPlays)} />
                  <Row
                    label="Досмотрели до конца"
                    value={
                      creative.videoPlays
                        ? `${formatNumber(creative.videoCompletions)} · ${formatPercent(
                            (creative.videoCompletions / creative.videoPlays) * 100,
                            1,
                          )}`
                        : formatNumber(creative.videoCompletions)
                    }
                  />
                  <Row
                    label="Среднее время просмотра"
                    value={
                      creative.videoAvgSeconds
                        ? `${formatNumber(creative.videoAvgSeconds, 1)} сек`
                        : '—'
                    }
                  />
                  <Row
                    label="Из просмотра в клик"
                    value={
                      creative.videoPlays
                        ? formatPercent((creative.clicks / creative.videoPlays) * 100, 1)
                        : '—'
                    }
                  />
                </dl>
              </Card>
            ) : null}

            <Card>
              <CardHeader
                title="Название в отчётах"
                subtitle="Как этот ролик подписан в таблицах платформы"
              />
              <CreativeRenameForm
                creativeId={creative.id}
                label={creative.rawLabel}
                fallback={creative.label}
                disabled={profile.role !== 'DIRECTOR'}
              />
            </Card>

            <Card>
              <CardHeader title="Объявление" subtitle="Текст, который видит человек" />
              <dl className="divide-y divide-line">
                <Row label="Название в Meta" value={creative.name || '—'} />
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

        {/*
          Ради этой таблицы всё и затевалось: не «ролик принёс 16 продаж», а
          вот эти люди, с именами и суммами. Период — тот же, что наверху.
        */}
        <Card className="mt-4">
          <CardHeader
            title="Кто купил с этого ролика"
            subtitle={
              buyers.length
                ? `${formatNumber(buyers.length)} на ${formatMoney(bought, { currency })} за ${range.label}`
                : `За ${range.label} покупок с этого ролика нет`
            }
          />
          {buyers.length > 0 ? (
            <TableShell
              columns={buyerColumns(currency)}
              minWidth={{ base: 340, md: 720, lg: 860 }}
            >
              {buyers.map((buyer) => (
                <tr key={buyer.saleId} className="transition-colors hover:bg-surface-2/60">
                  <Td first truncate="md" title={buyer.name} className="font-medium text-ink">
                    {buyer.phone ? (
                      <Link
                        href={`/dashboard/leads?q=${encodeURIComponent(buyer.phone)}`}
                        className="text-lime transition-colors hover:text-lime-strong"
                      >
                        {buyer.name}
                      </Link>
                    ) : (
                      buyer.name
                    )}
                  </Td>
                  <Td showFrom="md" className="tabular text-ink-soft">
                    {buyer.phone ?? '—'}
                  </Td>
                  <Td showFrom="lg" className="tabular text-muted">
                    {buyer.leadDate ? formatDate(buyer.leadDate) : '—'}
                  </Td>
                  <Td showFrom="md" className="tabular text-ink-soft">
                    {formatDate(buyer.saleDate)}
                  </Td>
                  <Td last align="right" className="tabular font-medium text-ink">
                    {formatMoney(buyer.amount, { currency })}
                  </Td>
                </tr>
              ))}
            </TableShell>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted sm:px-6">
              Заявки с ролика есть, а оплат пока нет. Как только продажу отметят в
              кабинете, она появится здесь.
            </p>
          )}
        </Card>
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
