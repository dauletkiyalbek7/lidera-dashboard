import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
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

/**
 * Тип показателя задаёт цвет строки: количество, деньги, стоимость одного
 * действия, проценты. Частота — просто число, без цвета.
 */
type Kind = 'count' | 'money' | 'cost' | 'percent' | 'plain';

/** Классы перечислены целиком: Tailwind ищет их в исходниках по тексту. */
const KIND_TEXT: Record<Kind, string> = {
  count: 'text-kind-count',
  money: 'text-kind-money',
  cost: 'text-kind-cost',
  percent: 'text-kind-percent',
  plain: 'text-ink',
};

const KIND_DOT: Record<Kind, string> = {
  count: 'bg-kind-count',
  money: 'bg-kind-money',
  cost: 'bg-kind-cost',
  percent: 'bg-kind-percent',
  plain: 'bg-line-strong',
};

const LEGEND: { kind: Kind; label: string }[] = [
  { kind: 'count', label: 'количество' },
  { kind: 'money', label: 'деньги' },
  { kind: 'cost', label: 'цена за действие' },
  { kind: 'percent', label: 'проценты' },
];

/** Как показать значение в ячейке: день и итог месяца считаются по-разному. */
type Row =
  | { group: string; kind: Kind }
  | { label: string; kind: Kind; value: (day: RnpDay, isTotal: boolean) => string };

const int = (value: number) => (value ? formatNumber(value) : DASH);
const kzt = (value: number) => (value ? `${formatNumber(Math.round(value))} ₸` : DASH);
const usd = (value: number) => (value ? `$${formatNumber(value, 2)}` : DASH);
const per = (amount: number, count: number) => (count ? kzt(amount / count) : DASH);
const share = (part: number, whole: number, digits = 2) =>
  whole && part ? formatPercent((part / whole) * 100, digits) : DASH;

const ROWS: Row[] = [
  { group: 'Лиды', kind: 'count' },
  { label: 'Лид факт (кабинет)', kind: 'count', value: (d) => int(d.results) },
  { label: 'Лиды в платформе', kind: 'count', value: (d) => int(d.platformLeads) },
  { label: 'CPL', kind: 'cost', value: (d) => per(d.spendKzt, d.results) },
  { group: 'Охват и клики', kind: 'percent' },
  // Охват — уникальные люди: за месяц он не складывается из дней, а честной
  // месячной цифры в базе нет. Поэтому в итоге прочерк, а не завышенная сумма.
  { label: 'Охват', kind: 'count', value: (d, total) => (total ? DASH : int(d.reach)) },
  { label: 'Показы', kind: 'count', value: (d) => int(d.impressions) },
  {
    label: 'Частота',
    kind: 'plain',
    value: (d, total) => (total || !d.reach ? DASH : formatNumber(d.impressions / d.reach, 2)),
  },
  { label: 'Клики', kind: 'count', value: (d) => int(d.clicks) },
  {
    label: 'CTR (клики/охват)',
    kind: 'percent',
    value: (d, total) => (total ? DASH : share(d.clicks, d.reach)),
  },
  { label: 'CTR (клики/показы)', kind: 'percent', value: (d) => share(d.clicks, d.impressions) },
  { label: 'CPC', kind: 'cost', value: (d) => per(d.spendKzt, d.clicks) },
  {
    label: 'CPM',
    kind: 'cost',
    value: (d) => (d.impressions ? kzt((d.spendKzt / d.impressions) * 1000) : DASH),
  },
  { group: 'Деньги', kind: 'money' },
  { label: 'Бюджет, ₸', kind: 'money', value: (d) => kzt(d.spendKzt) },
  { label: 'Бюджет, $', kind: 'money', value: (d) => usd(d.spendUsd) },
  { label: 'Продажи, шт.', kind: 'count', value: (d) => int(d.sales) },
  { label: 'Лид конверсия', kind: 'percent', value: (d) => share(d.sales, d.results) },
  { label: 'CAC', kind: 'cost', value: (d) => per(d.spendKzt, d.sales) },
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

/** Итоги месяца плитками — тем же цветом, что и строки таблицы. */
export function RnpSummary({ total, projects }: { total: RnpDay; projects: RnpProject[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryTile kind="money" label="Потратили" value={usd(total.spendUsd)} hint={kzt(total.spendKzt)} />
      <SummaryTile
        kind="count"
        label="Лиды по кабинету"
        value={int(total.results)}
        hint={projects.length > 1 ? breakdown(projects) : 'заявки и переписки из кабинета'}
      />
      <SummaryTile
        kind="cost"
        label="Цена лида"
        value={per(total.spendKzt, total.results)}
        hint="расход ÷ лиды кабинета"
      />
      <SummaryTile
        kind="count"
        label="Лиды в платформе"
        value={int(total.platformLeads)}
        hint="заявки с рекламы, дошедшие до CRM"
      />
    </div>
  );
}

function SummaryTile({
  kind,
  label,
  value,
  hint,
}: {
  kind: Kind;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-panel border border-line bg-surface p-4 sm:p-5">
      <span className={`absolute inset-x-0 top-0 h-1 ${KIND_DOT[kind]}`} aria-hidden />
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={`tabular mt-2 text-2xl font-bold tracking-[-0.02em] sm:text-[28px] ${KIND_TEXT[kind]}`}>
        {value}
      </p>
      <p className="mt-1.5 text-[12.5px] text-muted">{hint}</p>
    </div>
  );
}

/** Прочерк бледным: пустые дни не должны спорить с цифрами. */
function Cell({ value }: { value: string }) {
  return value === DASH ? <span className="font-normal text-faint">{DASH}</span> : <>{value}</>;
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
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-b border-line px-5 py-3 text-[12px] text-muted sm:px-6">
        {LEGEND.map((item) => (
          <li key={item.kind} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${KIND_DOT[item.kind]}`} aria-hidden />
            <span className={`font-medium ${KIND_TEXT[item.kind]}`}>{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto p-3 sm:p-4" role="region" aria-labelledby={titleId} tabIndex={0}>
        <table className="tabular w-full border-separate border-spacing-0 text-[13px]">
          <caption id={titleId} className="sr-only">
            РНП: {project.name}
          </caption>
          <thead className="text-[12px] text-table-head-ink">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 rounded-l-xl bg-table-head px-4 py-2.5 text-left font-semibold"
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
                    className={`whitespace-nowrap px-2.5 py-2.5 text-right font-semibold ${
                      isToday ? 'bg-lime text-on-lime' : 'bg-table-head'
                    }`}
                  >
                    {day.slice(8)}.{day.slice(5, 7)}
                    <span
                      className={`block text-[11px] font-normal ${
                        isToday
                          ? 'text-on-lime/80'
                          : weekday === 0 || weekday === 6
                            ? 'text-[#ff8a80]'
                            : 'opacity-60'
                      }`}
                    >
                      {isToday ? 'сегодня' : WEEKDAYS[weekday]}
                    </span>
                  </th>
                );
              })}
              <th
                scope="col"
                className="whitespace-nowrap rounded-r-xl bg-lime px-4 py-2.5 text-right font-semibold text-on-lime"
              >
                Итого
                <span className="block text-[11px] font-normal text-on-lime/80">за месяц</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) =>
              'group' in row ? (
                <tr key={row.group}>
                  <th scope="rowgroup" colSpan={days.length + 2} className="px-1 pb-2 pt-5 text-left">
                    {/* Подпись держим у левого края, пока таблицу листают вбок. */}
                    <span
                      className={`sticky left-1 inline-flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.1em] ${KIND_TEXT[row.kind]}`}
                    >
                      <span className={`h-3.5 w-1 rounded-full ${KIND_DOT[row.kind]}`} aria-hidden />
                      {row.group}
                    </span>
                  </th>
                </tr>
              ) : (
                <tr key={row.label} className="group/row">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap border-b border-line bg-surface px-4 py-2 text-left font-medium text-ink group-hover/row:bg-surface-2"
                  >
                    <span className="flex items-center gap-2">
                      <span className={`size-1.5 shrink-0 rounded-full ${KIND_DOT[row.kind]}`} aria-hidden />
                      {row.label}
                    </span>
                  </th>
                  {project.days.map((day, index) => (
                    <td
                      key={days[index]}
                      className={`whitespace-nowrap border-b border-line px-2.5 py-2 text-right font-medium group-hover/row:bg-surface-2 ${
                        KIND_TEXT[row.kind]
                      } ${days[index] === today ? 'bg-lime/[0.07]' : ''}`}
                    >
                      <Cell value={row.value(day, false)} />
                    </td>
                  ))}
                  <td
                    className={`whitespace-nowrap border-b border-line bg-lime/[0.10] px-4 py-2 text-right font-bold ${KIND_TEXT[row.kind]}`}
                  >
                    <Cell value={row.value(project.total, true)} />
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
