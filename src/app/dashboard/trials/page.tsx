import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { PhoneCell } from '@/components/app/phone-cell';
import { DateRangePicker } from '@/components/app/date-range-picker';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTrials } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { safeDivide } from '@/lib/metrics';
import { currentRange } from '@/lib/period-preference';
import { getTrials } from '@/lib/queries';
import { trialStatusMeta, wasHeld } from '@/lib/trial-status';
import { trialWords } from '@/lib/trial-term';
import { TrialStatusSelect } from './trial-controls';

export const metadata: Metadata = { title: 'Пробные уроки' };

/**
 * Кто смотрит раздел — тот и решает, что в нём показывать.
 *
 * Продажнику это расписание: его уроки по дням занятий. Менеджеру — его
 * работа: кого он записал, кому передал и чем это кончилось. Раздел один,
 * но вопросы у них разные, и одинаковая таблица не отвечает ни на один.
 */
type TrialsView = 'manager' | 'seller' | 'head';

/** На телефоне остаётся суть: кто на пробном и чем оно закончилось. */
function columnsFor(view: TrialsView): TableColumn[] {
  return [
    { key: 'lead', label: 'Клиент' },
    { key: 'phone', label: 'Телефон', showFrom: 'lg' as const },
    ...(view === 'seller'
      ? []
      : [{ key: 'sold', label: 'Продан', showFrom: 'md' as const }]),
    { key: 'date', label: 'Урок', showFrom: 'md' as const },
    ...(view === 'seller'
      ? []
      : [
          {
            key: 'seller',
            label: view === 'manager' ? 'Кому передал' : 'Ведёт',
            showFrom: 'md' as const,
          },
        ]),
    { key: 'status', label: 'Статус' },
  ];
}

/** Ширина таблицы для каждого набора видимых колонок. */
const TABLE_MIN_WIDTH = { base: 340, md: 720 };

export default async function TrialsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { company, employee } = await requireCompanySession();

  // У компаний с прямой продажей пробных занятий нет — раздел им не показывается.
  if (company.funnel_type !== 'trial') redirect('/dashboard');

  const view: TrialsView =
    employee?.role === 'manager'
      ? 'manager'
      : employee?.role === 'salesperson'
        ? 'seller'
        : 'head';

  // Слово компании: у школы «Пробный урок», у Дарына «Вебинар».
  const words = trialWords(company.trial_term);
  const range = await currentRange(await searchParams, company.timezone);

  // Менеджер отбирает по дню продажи, остальные — по дню занятия. Он записал
  // сегодня девятнадцать человек на всю неделю вперёд; по дню занятия его
  // сегодняшняя работа показала бы три записи из девятнадцати.
  const trials = await getTrials(company.id, range.from, range.to, {
    timeZone: company.timezone,
    basis: view === 'manager' ? 'sold' : 'lesson',
    managerId: view === 'manager' ? (employee?.id ?? null) : null,
    sellerId: view === 'seller' ? (employee?.id ?? null) : null,
  });

  // Урок состоялся — это и «Проведён», и любой исход после него: клиент
  // купил или отказался уже после занятия.
  const held = trials.filter((trial) => wasHeld(trial.status)).length;
  const noShow = trials.filter((trial) => trial.status === 'no_show').length;
  const sold = trials.filter((trial) => trial.status === 'sale').length;
  // Отказ банка по рассрочке считаем отдельно: клиент хотел купить, и в
  // потери продажника это не идёт.
  const bankDeclined = trials.filter((trial) => trial.status === 'bank_declined').length;

  return (
    <>
      <PageHeader
        title={words.section}
        description={
          view === 'manager'
            ? 'Кого вы записали, кому передали и чем занятие закончилось. Период — по дню продажи.'
            : view === 'seller'
              ? 'Ваши занятия по дням: с кем говорить, когда и чем закончилось.'
              : 'Время согласовано с клиентом и закреплено за свободным продажником.'
        }
        action={<DateRangePicker range={range} />}
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile
            label={view === 'manager' ? 'Продано уроков' : 'Всего записей'}
            value={formatNumber(trials.length)}
          />
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
            label="Банк не одобрил"
            value={formatNumber(bankDeclined)}
            hint="Хотели в рассрочку — банк отказал"
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
            subtitle={
              view === 'manager'
                ? `Продано за период: ${range.label}`
                : `Период: ${range.label}`
            }
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
            <TableShell columns={columnsFor(view)} minWidth={TABLE_MIN_WIDTH}>
              {trials.map((trial) => (
                <tr key={trial.id} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="font-medium text-ink">
                    {trial.leadName ?? 'Без имени'}
                  </Td>
                  <Td showFrom="lg" className="tabular text-ink-soft">
                    <PhoneCell phone={trial.leadPhone} />
                  </Td>
                  {view !== 'seller' && (
                    <Td showFrom="md" className="tabular text-ink-soft">
                      {formatDateTime(trial.createdAt, company.timezone)}
                    </Td>
                  )}
                  <Td showFrom="md" className="tabular text-ink-soft">
                    {trial.startsAt ? (
                      formatDateTime(trial.startsAt, company.timezone)
                    ) : (
                      <span className="text-faint">
                        {formatDate(trial.date)} · время не назначено
                      </span>
                    )}
                  </Td>
                  {view !== 'seller' && (
                    <Td showFrom="md" className="text-ink-soft">
                      {trial.sellerName ?? (
                        <span className="text-faint">ждёт продажника</span>
                      )}
                    </Td>
                  )}
                  <Td last>
                    {view === 'manager' ? (
                      // Исход урока ставит тот, кто его вёл. Менеджеру здесь
                      // нечего менять — он смотрит, чем кончилась его работа.
                      <Badge tone={trialStatusMeta(trial.status).tone}>
                        {trialStatusMeta(trial.status).label}
                      </Badge>
                    ) : (
                      <TrialStatusSelect
                        trialId={trial.id}
                        status={trial.status}
                        leadId={trial.leadId}
                        leadName={trial.leadName}
                        saleAmount={trial.saleAmount}
                        currency={company.sales_currency}
                      />
                    )}
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
