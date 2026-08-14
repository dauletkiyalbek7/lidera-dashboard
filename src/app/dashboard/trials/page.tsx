import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Td, TableShell } from '@/components/app/table';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTrials } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import { safeDivide } from '@/lib/metrics';
import { resolveRange } from '@/lib/period';
import { getTrials } from '@/lib/queries';
import { TrialStatusSelect } from './trial-controls';

export const metadata: Metadata = { title: 'Пробные' };

const COLUMNS = [
  { key: 'lead', label: 'Клиент' },
  { key: 'phone', label: 'Телефон' },
  { key: 'date', label: 'Дата' },
  { key: 'seller', label: 'Проводит' },
  { key: 'status', label: 'Статус' },
];

export default async function TrialsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();

  // У компаний с прямой продажей пробных занятий нет — раздел им не показывается.
  if (company.funnel_type !== 'trial') redirect('/dashboard');

  const range = resolveRange(await searchParams, company.timezone);
  const trials = await getTrials(company.id, range.from, range.to);

  const completed = trials.filter((trial) => trial.status === 'completed').length;
  const noShow = trials.filter((trial) => trial.status === 'no_show').length;

  return (
    <>
      <PageHeader
        title="Пробные"
        description="Промежуточный шаг воронки: сколько записей дошли до реально проведённого пробного."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Всего записей" value={formatNumber(trials.length)} />
          <StatTile
            label="Проведено"
            value={formatNumber(completed)}
            accent
            hint={`Доходимость: ${formatPercent(safeDivide(completed, trials.length) * 100)}`}
          />
          <StatTile label="Не пришли" value={formatNumber(noShow)} />
        </div>

        <Card className="mt-4">
          <CardHeader title="Записи на пробные" subtitle={`Период: ${range.label}`} />
          {trials.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconTrials className="size-5" />}
                title="Пробных за этот период нет"
                description="Записать лид на пробное можно кнопкой «Пробный» в разделе «Лиды»."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS}>
              {trials.map((trial) => (
                <tr key={trial.id} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="font-medium text-ink">
                    {trial.leadName ?? 'Без имени'}
                  </Td>
                  <Td className="tabular text-ink-soft">{trial.leadPhone ?? '—'}</Td>
                  <Td className="tabular text-ink-soft">{formatDate(trial.date)}</Td>
                  <Td className="text-ink-soft">
                    {trial.sellerName ?? (
                      <span className="text-faint">ждёт продажника</span>
                    )}
                  </Td>
                  <Td last>
                    <TrialStatusSelect trialId={trial.id} status={trial.status} />
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
