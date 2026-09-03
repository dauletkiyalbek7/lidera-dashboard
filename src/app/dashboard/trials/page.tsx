import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTrials } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { safeDivide } from '@/lib/metrics';
import { currentRange } from '@/lib/period-preference';
import { getTrials } from '@/lib/queries';
import { wasHeld } from '@/lib/trial-status';
import { trialWords } from '@/lib/trial-term';
import { TrialStatusSelect } from './trial-controls';

export const metadata: Metadata = { title: 'Пробные уроки' };

/** На телефоне остаётся суть: кто на пробном и чем оно закончилось. */
const COLUMNS: TableColumn[] = [
  { key: 'lead', label: 'Клиент' },
  { key: 'phone', label: 'Телефон', showFrom: 'lg' },
  { key: 'date', label: 'Когда', showFrom: 'md' },
  { key: 'seller', label: 'Ведёт', showFrom: 'md' },
  { key: 'status', label: 'Статус' },
];

/** Ширина таблицы для каждого набора видимых колонок. */
const TABLE_MIN_WIDTH = { base: 340, md: 720 };

export default async function TrialsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company } = await requireCompanySession();

  // У компаний с прямой продажей пробных занятий нет — раздел им не показывается.
  if (company.funnel_type !== 'trial') redirect('/dashboard');

  // Слово компании: у школы «Пробный урок», у Дарына «Вебинар».
  const words = trialWords(company.trial_term);
  const range = await currentRange(await searchParams, company.timezone);
  const trials = await getTrials(company.id, range.from, range.to);

  // Урок состоялся — это и «Проведён», и любой исход после него: клиент
  // купил или отказался уже после занятия.
  const held = trials.filter((trial) => wasHeld(trial.status)).length;
  const noShow = trials.filter((trial) => trial.status === 'no_show').length;
  const sold = trials.filter((trial) => trial.status === 'sale').length;

  return (
    <>
      <PageHeader
        title={words.section}
        description="Время согласовано с клиентом и закреплено за свободным продажником."
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
          <CardHeader
            title={`Записи на ${words.accusative}`}
            subtitle={`Период: ${range.label}`}
          />
          {trials.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconTrials className="size-5" />}
                title="Записей за этот период нет"
                description={`Записать клиента можно кнопкой «${words.leadStatus}» в разделе «Лиды» — там же выбирается время и свободный продажник.`}
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={TABLE_MIN_WIDTH}>
              {trials.map((trial) => (
                <tr key={trial.id} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="font-medium text-ink">
                    {trial.leadName ?? 'Без имени'}
                  </Td>
                  <Td showFrom="lg" className="tabular text-ink-soft">
                    {trial.leadPhone ?? '—'}
                  </Td>
                  <Td showFrom="md" className="tabular text-ink-soft">
                    {trial.startsAt ? (
                      formatDateTime(trial.startsAt, company.timezone)
                    ) : (
                      <span className="text-faint">
                        {formatDate(trial.date)} · время не назначено
                      </span>
                    )}
                  </Td>
                  <Td showFrom="md" className="text-ink-soft">
                    {trial.sellerName ?? (
                      <span className="text-faint">ждёт продажника</span>
                    )}
                  </Td>
                  <Td last>
                    <TrialStatusSelect
                      trialId={trial.id}
                      status={trial.status}
                      leadId={trial.leadId}
                      leadName={trial.leadName}
                      saleAmount={trial.saleAmount}
                      currency={company.sales_currency}
                    />
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
