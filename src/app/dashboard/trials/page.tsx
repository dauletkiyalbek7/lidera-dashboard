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
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { safeDivide } from '@/lib/metrics';
import { resolveRange } from '@/lib/period';
import { getTrials } from '@/lib/queries';
import { wasHeld } from '@/lib/trial-status';
import { TrialStatusSelect } from './trial-controls';

export const metadata: Metadata = { title: 'Пробные' };

const COLUMNS = [
  { key: 'lead', label: 'Клиент' },
  { key: 'phone', label: 'Телефон' },
  { key: 'date', label: 'Когда' },
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

  // Урок состоялся — это и «Проведён», и любой исход после него: клиент
  // купил или отказался уже после занятия.
  const held = trials.filter((trial) => wasHeld(trial.status)).length;
  const noShow = trials.filter((trial) => trial.status === 'no_show').length;
  const sold = trials.filter((trial) => trial.status === 'sale').length;

  return (
    <>
      <PageHeader
        title="Пробные"
        description="Онлайн-урок: время согласовано с клиентом и закреплено за свободным продажником."
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile label="Всего записей" value={formatNumber(trials.length)} />
          <StatTile
            label="Урок состоялся"
            value={formatNumber(held)}
            accent
            hint={`Доходимость: ${formatPercent(safeDivide(held, trials.length) * 100)}`}
          />
          <StatTile
            label="Купили курс"
            value={formatNumber(sold)}
            hint={`Из проведённых: ${formatPercent(safeDivide(sold, held) * 100)}`}
          />
          <StatTile
            label="Не вышли на связь"
            value={formatNumber(noShow)}
            hint="Урок был назначен, клиент не подключился"
          />
        </div>

        <Card className="mt-4">
          <CardHeader title="Записи на пробные" subtitle={`Период: ${range.label}`} />
          {trials.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconTrials className="size-5" />}
                title="Пробных за этот период нет"
                description="Записать клиента на урок можно кнопкой «Пробный» в разделе «Лиды» — там же выбирается время и свободный продажник."
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
                  <Td className="tabular text-ink-soft">
                    {trial.startsAt ? (
                      formatDateTime(trial.startsAt)
                    ) : (
                      <span className="text-faint">
                        {formatDate(trial.date)} · время не назначено
                      </span>
                    )}
                  </Td>
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
