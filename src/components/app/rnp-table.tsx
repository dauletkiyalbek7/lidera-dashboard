import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';
import { formatNumber, formatPercent } from '@/lib/format';
import { shiftMonth, type RnpDay, type RnpProject } from '@/lib/rnp';

/**
 * Куски РНП, общие для кабинета и открытой ссылки: таблица проекта, итоги
 * месяца, стрелки по месяцам и сноска. Страницы различаются только тем, кто
 * их смотрит и какие проекты в них попадают.
 */

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const DASH = '—';

/** Как показать значение в ячейке: день и итог месяца считаются по-разному. */
type Row =
  | { group: string }
  | { label: string; value: (day: RnpDay, isTotal: boolean) => string };

const int = (value: number) => (value ? formatNumber(value) : DASH);
const kzt = (value: number) => (value ? `${formatNumber(Math.round(value))} ₸` : DASH);
const usd = (value: number) => (value ? `$${formatNumber(value, 2)}` : DASH);
const per = (amount: number, count: number) => (count ? kzt(amount / count) : DASH);
const share = (part: number, whole: number, digits = 2) =>
  whole && part ? formatPercent((part / whole) * 100, digits) : DASH;

const ROWS: Row[] = [
  { group: 'Лиды' },
  { label: 'Лид факт (кабинет)', value: (d) => int(d.results) },
  { label: 'Лиды в платформе', value: (d) => int(d.platformLeads) },
  { label: 'CPL', value: (d) => per(d.spendKzt, d.results) },
  { group: 'Охват и клики' },
  // Охват — уникальные люди: за месяц он не складывается из дней, а честной
  // месячной цифры в базе нет. Поэтому в итоге прочерк, а не завышенная сумма.
  { label: 'Охват', value: (d, total) => (total ? DASH : int(d.reach)) },
  { label: 'Показы', value: (d) => int(d.impressions) },
  {
    label: 'Частота',
    value: (d, total) => (total || !d.reach ? DASH : formatNumber(d.impressions / d.reach, 2)),
  },
  { label: 'Клики', value: (d) => int(d.clicks) },
  { label: 'CTR (клики/охват)', value: (d, total) => (total ? DASH : share(d.clicks, d.reach)) },
  { label: 'CTR (клики/показы)', value: (d) => share(d.clicks, d.impressions) },
  { label: 'CPC', value: (d) => per(d.spendKzt, d.clicks) },
  { label: 'CPM', value: (d) => (d.impressions ? kzt((d.spendKzt / d.impressions) * 1000) : DASH) },
  { group: 'Деньги' },
  { label: 'Бюджет, ₸', value: (d) => kzt(d.spendKzt) },
  { label: 'Бюджет, $', value: (d) => usd(d.spendUsd) },
  { label: 'Продажи, шт.', value: (d) => int(d.sales) },
  { label: 'Лид конверсия', value: (d) => share(d.sales, d.results) },
  { label: 'CAC', value: (d) => per(d.spendKzt, d.sales) },
];

export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}

/** Есть ли за месяц хоть что-то: иначе вместо пустых таблиц — заглушка. */
export function hasActivity(total: RnpDay): boolean {
  return total.impressions + total.spendUsd + total.platformLeads > 0;
}

/** Стрелки по месяцам; вперёд дальше текущего месяца не пускаем. */
export function RnpMonthNav({
  month,
  isCurrent,
  hrefFor,
}: {
  month: string;
  isCurrent: boolean;
  hrefFor: (month: string) => string;
}) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <nav className="flex items-center gap-2" aria-label="Месяц">
      <ButtonLink href={hrefFor(previous)} variant="secondary" size="field">
        ← {MONTH_NAMES[Number(previous.slice(5)) - 1]}
      </ButtonLink>
      <span className="min-w-[128px] text-center text-[14px] font-semibold text-ink">
        {monthLabel(month)}
      </span>
      {isCurrent ? null : (
        <ButtonLink href={hrefFor(next)} variant="secondary" size="field">
          {MONTH_NAMES[Number(next.slice(5)) - 1]} →
        </ButtonLink>
      )}
    </nav>
  );
}

/** Итоги месяца плитками. */
export function RnpSummary({ total, projects }: { total: RnpDay; projects: RnpProject[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Потратили" value={usd(total.spendUsd)} hint={kzt(total.spendKzt)} accent />
      <StatTile
        label="Лиды по кабинету"
        value={int(total.results)}
        hint={projects.length > 1 ? breakdown(projects) : undefined}
      />
      <StatTile label="Цена лида" value={per(total.spendKzt, total.results)} hint="расход ÷ лиды кабинета" />
      <StatTile
        label="Лиды в платформе"
        value={int(total.platformLeads)}
        hint="заявки с рекламы, дошедшие до CRM"
      />
    </div>
  );
}

export function RnpNote({ isCurrent }: { isCurrent: boolean }) {
  return (
    <p className="max-w-3xl text-[12.5px] leading-relaxed text-faint">
      {isCurrent
        ? 'Сегодняшний день дополняется в течение дня, вчерашний кабинет уточняет ещё сутки-двое. '
        : ''}
      Бюджет в тенге пересчитан из долларов по курсу Нацбанка на каждый день. Сутки считаются по
      часам проекта, поэтому с кабинетом в другом часовом поясе дни могут расходиться на несколько
      долларов. Продажи — все оплаченные продажи проекта по дате продажи, не только с рекламы.
      Охват в итоге месяца не показываем: уникальные люди по дням не складываются.
    </p>
  );
}

export function RnpProjectTable({
  project,
  days,
  today,
}: {
  project: RnpProject;
  days: string[];
  today: string;
}) {
  const titleId = `rnp-${project.id}`;

  return (
    <Card>
      <CardHeader
        title={project.name}
        subtitle={`Расход ${usd(project.total.spendUsd)} · лидов ${int(project.total.results)} · CPL ${per(
          project.total.spendKzt,
          project.total.results,
        )}`}
      />
      <div className="overflow-x-auto" role="region" aria-labelledby={titleId} tabIndex={0}>
        <table className="tabular w-full border-separate border-spacing-0 text-[13px]">
          <caption id={titleId} className="sr-only">
            РНП: {project.name}
          </caption>
          <thead className="text-[12px] text-muted">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-2.5 text-left font-medium sm:px-6"
              >
                Показатель
              </th>
              {days.map((day) => {
                const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
                const isToday = day === today;
                return (
                  <th
                    key={day}
                    scope="col"
                    className={`whitespace-nowrap border-b border-line px-2.5 py-2.5 text-right font-medium ${
                      isToday ? 'bg-lime/[0.08] text-ink' : ''
                    }`}
                  >
                    {day.slice(8)}.{day.slice(5, 7)}
                    <span
                      className={`block text-[11px] font-normal ${
                        weekday === 0 || weekday === 6 ? 'text-negative/80' : 'text-faint'
                      }`}
                    >
                      {isToday ? 'сегодня' : WEEKDAYS[weekday]}
                    </span>
                  </th>
                );
              })}
              <th
                scope="col"
                className="whitespace-nowrap border-b border-line bg-surface-2 px-4 py-2.5 text-right font-semibold text-ink"
              >
                Итого
                <span className="block text-[11px] font-normal text-faint">за месяц</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) =>
              'group' in row ? (
                <tr key={row.group}>
                  <th
                    scope="rowgroup"
                    colSpan={days.length + 2}
                    className="px-4 pb-1.5 pt-4 text-left text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint sm:px-6"
                  >
                    {/* Подпись держим у левого края, пока таблицу листают вбок. */}
                    <span className="sticky left-4 sm:left-6">{row.group}</span>
                  </th>
                </tr>
              ) : (
                <tr key={row.label} className="hover:bg-surface-2/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap border-b border-line bg-surface px-4 py-2 text-left font-medium text-ink-soft sm:px-6"
                  >
                    {row.label}
                  </th>
                  {project.days.map((day, index) => (
                    <td
                      key={days[index]}
                      className={`whitespace-nowrap border-b border-line px-2.5 py-2 text-right text-ink ${
                        days[index] === today ? 'bg-lime/[0.05]' : ''
                      }`}
                    >
                      {row.value(day, false)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap border-b border-line bg-surface-2 px-4 py-2 text-right font-semibold text-ink">
                    {row.value(project.total, true)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function breakdown(projects: RnpProject[]): string {
  return projects
    .filter((project) => project.total.results > 0)
    .map((project) => `${project.name} ${formatNumber(project.total.results)}`)
    .join(' · ');
}
