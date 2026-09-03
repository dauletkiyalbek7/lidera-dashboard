import type { Metadata } from 'next';
import Link from 'next/link';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell } from '@/components/app/table';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconIntegrations } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireAdsAccess } from '@/lib/auth';
import { getCapiOverview, getCompanyCapiSettings } from '@/lib/capi-queries';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { currentRange } from '@/lib/period-preference';
import { CapiSettingsForm } from './settings-form';
import { PendingSend, QualityMark } from './pending-list';

/**
 * Раздел «CAPI» — что платформа рассказала Meta о покупках.
 *
 * Пиксель видит только сайт, а курс оплачивают позже: переводом, в рассрочку,
 * после разговора. Обучать рекламу на этих покупках можно, только если мы
 * сами сообщим о них — здесь видно, о каких сообщили и о каких нет.
 */

export const metadata: Metadata = { title: 'CAPI' };

const COLUMNS = [
  { key: 'date', label: 'Отправлено' },
  { key: 'customer', label: 'Покупатель' },
  { key: 'phone', label: 'Телефон' },
  { key: 'creative', label: 'Креатив' },
  { key: 'value', label: 'Сумма', align: 'right' as const },
  { key: 'status', label: 'Ответ Meta' },
];

const PENDING_COLUMNS = [
  { key: 'date', label: 'Продажа' },
  { key: 'customer', label: 'Покупатель' },
  { key: 'phone', label: 'Телефон' },
  { key: 'creative', label: 'Креатив' },
  { key: 'quality', label: 'Оценка' },
  { key: 'amount', label: 'Сумма', align: 'right' as const },
  { key: 'send', label: '', align: 'right' as const },
];

export default async function CapiPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireAdsAccess();
  const range = await currentRange(await searchParams, company.timezone);

  const [overview, settings] = await Promise.all([
    getCapiOverview(company.id, range.from, range.to, company.timezone),
    getCompanyCapiSettings(company.id),
  ]);

  return (
    <>
      <PageHeader
        title="CAPI — покупки в Meta"
        description="Оплаты приходят позже клика, и пиксель их не видит. Платформа сообщает о них сама — здесь видно, что именно ушло."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Отправлено покупок"
            value={formatNumber(overview.sent)}
            hint={`За ${range.label}`}
            accent
          />
          <StatTile
            label="Не ушло"
            value={formatNumber(overview.failed)}
            hint={overview.failed ? 'Meta отклонила событие — причина в таблице' : 'Ошибок нет'}
          />
          <StatTile
            label="Ждут отправки"
            value={formatNumber(overview.pending.length)}
            hint={
              overview.pending.length
                ? 'Оплачены — решите, кого отправлять в рекламный кабинет'
                : 'Очередь пуста'
            }
          />
          <StatTile
            label="Последняя отправка"
            value={settings?.lastEventAt ? formatDateTime(settings.lastEventAt, company.timezone) : '—'}
            hint={
              settings?.enabled === false
                ? 'Отправка выключена в настройках'
                : (settings?.lastError ?? 'Ошибок нет')
            }
          />
        </div>

        {settings?.lastError ? (
          <Card className="mt-4 border-negative/30">
            <div className="p-5 sm:p-6">
              <p className="text-[13px] font-medium text-negative">
                Последняя ошибка отправки
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                {settings.lastError}
              </p>
            </div>
          </Card>
        ) : null}

        {overview.pending.length > 0 ? (
          <Card className="mt-4">
            <CardHeader
              title="Ждут отправки в Meta"
              subtitle="Оценку ставит продажник сразу после продажи. На холодных клиентах рекламу учить вредно — она пойдёт искать таких же"
            />
            <TableShell columns={PENDING_COLUMNS} minWidth={900}>
              {overview.pending.map((sale) => (
                <tr key={sale.saleId} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="tabular text-muted">{formatDate(sale.date)}</Td>
                  <Td className="font-medium text-ink">{sale.customerName ?? 'Без имени'}</Td>
                  <Td className="tabular text-ink-soft">{sale.phone ?? '—'}</Td>
                  <Td className="text-ink-soft">
                    {sale.creativeId && sale.creativeName ? (
                      <Link
                        href={`/dashboard/creatives/${sale.creativeId}`}
                        className="whitespace-nowrap text-lime transition-colors hover:text-lime-strong"
                      >
                        {sale.creativeName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td><QualityMark quality={sale.quality} /></Td>
                  <Td align="right" className="tabular text-ink">
                    {formatMoney(sale.amount, { currency: company.sales_currency })}
                  </Td>
                  <Td last align="right">
                    <PendingSend saleId={sale.saleId} quality={sale.quality} />
                  </Td>
                </tr>
              ))}
            </TableShell>
          </Card>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Отправленные события"
              subtitle="Каждая строка — одна покупка, о которой узнала Meta"
            />
            {overview.events.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState
                  icon={<IconIntegrations className="size-5" />}
                  title="Событий за этот период нет"
                  description="События уходят, когда продажа отмечена оплаченной. Проверьте, что набор данных и токен заданы, а отправка включена."
                  action={
                    <ButtonLink href="/dashboard/sales" variant="secondary">
                      Перейти к продажам
                    </ButtonLink>
                  }
                />
              </div>
            ) : (
              <TableShell columns={COLUMNS} minWidth={900}>
                {overview.events.map((event) => (
                  <tr key={event.id} className="transition-colors hover:bg-surface-2/60">
                    <Td first className="tabular text-muted">
                      {formatDateTime(event.createdAt, company.timezone)}
                    </Td>
                    <Td className="font-medium text-ink">
                      {event.test ? (
                        <span className="text-muted">Проверочное событие</span>
                      ) : (
                        (event.customerName ?? 'Без имени')
                      )}
                    </Td>
                    <Td className="tabular text-ink-soft">{event.phone ?? '—'}</Td>
                    <Td className="text-ink-soft">
                      {event.creativeId && event.creativeName ? (
                        <Link
                          href={`/dashboard/creatives/${event.creativeId}`}
                          className="whitespace-nowrap text-lime transition-colors hover:text-lime-strong"
                        >
                          {event.creativeName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td align="right" className="tabular text-ink">
                      {formatMoney(event.value, {
                        currency: event.currency ?? company.sales_currency,
                      })}
                    </Td>
                    <Td last>
                      <span
                        className={`text-[12.5px] ${
                          event.status === 'sent' ? 'text-lime' : 'text-negative'
                        }`}
                      >
                        {event.status === 'sent' ? '✓ ' : '✕ '}
                        {event.response ?? (event.status === 'sent' ? 'принято' : 'ошибка')}
                      </span>
                    </Td>
                  </tr>
                ))}
              </TableShell>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Настройки отправки"
              subtitle="Набор данных и токен из Events Manager"
            />
            <CapiSettingsForm
              datasetId={settings?.datasetId ?? ''}
              testEventCode={settings?.testEventCode ?? null}
              enabled={settings?.enabled ?? true}
              hasToken={settings?.hasToken ?? false}
            />
          </Card>
        </div>
      </PageBody>
    </>
  );
}
