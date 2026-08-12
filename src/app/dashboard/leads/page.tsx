import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Td, TableShell } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconLeads } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import { LEAD_STATUS, PLATFORM_LABELS, statusOf } from '@/lib/labels';
import { resolveRange } from '@/lib/period';
import { getLeads } from '@/lib/queries';

export const metadata: Metadata = { title: 'Лиды' };

const COLUMNS = [
  { key: 'name', label: 'Лид' },
  { key: 'phone', label: 'Телефон' },
  { key: 'source', label: 'Источник' },
  { key: 'creative', label: 'Креатив' },
  { key: 'status', label: 'Статус' },
  { key: 'created', label: 'Получен', align: 'right' as const },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();
  const range = resolveRange(await searchParams);
  const leads = await getLeads(company.id, range.from, range.to);

  const attributed = leads.filter((lead) => lead.creativeName).length;
  const converted = leads.filter((lead) => lead.status === 'sale').length;

  return (
    <>
      <PageHeader
        title="Лиды"
        description="Каждый лид хранит источник, площадку и креатив — это и есть основа сквозной аналитики."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Всего лидов" value={formatNumber(leads.length)} />
          <StatTile
            label="С привязкой к креативу"
            value={formatNumber(attributed)}
            hint="Только такие лиды участвуют в сквозной аналитике"
          />
          <StatTile label="Дошли до продажи" value={formatNumber(converted)} accent />
        </div>

        <Card className="mt-4">
          <CardHeader
            title="Список лидов"
            subtitle={`Показаны последние ${formatNumber(leads.length)} за ${range.label}`}
          />
          {leads.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconLeads className="size-5" />}
                title="Лидов за этот период нет"
                description="Лиды появятся автоматически после подключения рекламных кабинетов и форм заявок."
                action={
                  <ButtonLink href="/dashboard/integrations" variant="secondary">
                    Настроить интеграции
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={860}>
              {leads.map((lead) => {
                const status = statusOf(LEAD_STATUS, lead.status);
                return (
                  <tr key={lead.id} className="transition-colors hover:bg-surface-2/60">
                    <Td first className="font-medium text-ink">
                      {lead.name || 'Без имени'}
                    </Td>
                    <Td className="tabular text-ink-soft">{lead.phone ?? '—'}</Td>
                    <Td className="text-ink-soft">
                      {lead.platform
                        ? (PLATFORM_LABELS[lead.platform] ?? lead.platform)
                        : (lead.source ?? '—')}
                    </Td>
                    <Td className="text-ink-soft">{lead.creativeName ?? '—'}</Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td last align="right" className="tabular text-muted">
                      {formatDateTime(lead.created_at)}
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
