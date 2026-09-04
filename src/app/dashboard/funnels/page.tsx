import type { Metadata } from 'next';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconChain } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireFullAccess } from '@/lib/auth';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { safeDivide } from '@/lib/metrics';
import { currentRange } from '@/lib/period-preference';
import { getFunnelChannels } from '@/lib/queries';

export const metadata: Metadata = { title: 'Воронки' };

const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Канал' },
  { key: 'kind', label: 'Тип', showFrom: 'md' },
  { key: 'detail', label: 'Номер или площадка', showFrom: 'lg' },
  { key: 'department', label: 'Отдел', showFrom: 'xl' },
  { key: 'last', label: 'Последняя заявка', showFrom: 'lg' },
  { key: 'ads', label: 'С рекламы', align: 'right' as const, showFrom: 'md' },
  { key: 'leads', label: 'Заявок', align: 'right' as const },
];

const TABLE_MIN_WIDTH = { base: 380, md: 720, lg: 1040, xl: 1200 };

/**
 * Воронки: куда вообще приходят люди.
 *
 * Каналы заведены в разных местах — номера в «WhatsApp», формы сайта в
 * «Интеграциях», — и общей картины не было ни на одном экране. Здесь она
 * есть: какой канал сколько дал за период и жив ли он вообще.
 */
export default async function FunnelsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireFullAccess();
  const range = await currentRange(await searchParams, company.timezone);
  const channels = await getFunnelChannels(
    company.id,
    range.from,
    range.to,
    company.timezone,
  );

  const total = channels.reduce((sum, row) => sum + row.leads, 0);
  const fromAds = channels.reduce((sum, row) => sum + row.fromAds, 0);
  const working = channels.filter((row) => row.leads > 0).length;

  return (
    <>
      <PageHeader
        title="Воронки"
        description="Наши номера, сайты и формы — и сколько заявок дал каждый."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Каналов заведено" value={formatNumber(channels.length)} />
          <StatTile
            label="Работали за период"
            value={`${formatNumber(working)} из ${formatNumber(channels.length)}`}
            hint="Канал без заявок — либо выключен, либо о нём забыли"
          />
          <StatTile label="Заявок всего" value={formatNumber(total)} accent />
          <StatTile
            label="Пришли с рекламы"
            value={formatNumber(fromAds)}
            hint={`Доля: ${formatPercent(safeDivide(fromAds, total) * 100)}`}
          />
        </div>

        <Card className="mt-4">
          <CardHeader title="Каналы" subtitle={`Период: ${range.label}`} />
          {channels.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconChain className="size-5" />}
                title="Каналов пока нет"
                description="Номер WhatsApp подключается в разделе «WhatsApp», форма сайта — в «Интеграциях». После этого они появятся здесь."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={TABLE_MIN_WIDTH}>
              {channels.map((row) => (
                <tr
                  key={`${row.kind}:${row.id}`}
                  className="transition-colors hover:bg-surface-2/60"
                >
                  <Td first className="font-medium text-ink">
                    <div className="flex items-center gap-2">
                      {row.name}
                      {row.status === 'connected' || row.status === 'active' ? null : (
                        <Badge tone="neutral">не подключён</Badge>
                      )}
                    </div>
                  </Td>
                  <Td showFrom="md" className="text-ink-soft">
                    {row.kind === 'whatsapp' ? 'WhatsApp' : 'Форма на сайте'}
                  </Td>
                  <Td showFrom="lg" className="tabular text-ink-soft">
                    {row.detail ?? '—'}
                  </Td>
                  <Td showFrom="xl" className="text-ink-soft">
                    {row.departmentName ?? '—'}
                  </Td>
                  <Td showFrom="lg" className="tabular text-ink-soft">
                    {row.lastLeadAt ? (
                      formatDateTime(row.lastLeadAt, company.timezone)
                    ) : (
                      <span className="text-faint">заявок не было</span>
                    )}
                  </Td>
                  <Td showFrom="md" align="right" className="tabular text-ink-soft">
                    {row.fromAds > 0 ? formatNumber(row.fromAds) : '—'}
                  </Td>
                  <Td last align="right" className="tabular font-medium text-ink">
                    {formatNumber(row.leads)}
                  </Td>
                </tr>
              ))}
            </TableShell>
          )}
        </Card>
      </PageBody>
    </>
  );
}
