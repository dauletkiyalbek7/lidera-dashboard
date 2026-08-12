import { formatMoney, formatNumber, formatRatio } from '@/lib/format';

/**
 * Визуальный макет кабинета для hero-секции.
 * Статичный, лёгкий, без интерактива — задача показать продукт, а не считать.
 * Цифры совпадают с демо-компанией, чтобы обещание и кабинет не расходились.
 */

const KPI = [
  { label: 'Расход', value: formatMoney(100_000) },
  { label: 'Лиды', value: formatNumber(200) },
  { label: 'CPL', value: formatMoney(500) },
  { label: 'Выручка', value: formatMoney(750_000), accent: true },
];

const CREATIVES = [
  { name: 'Video 01', spend: 100_000, leads: 200, revenue: 750_000, roas: 7.5 },
  { name: 'Video 02', spend: 150_000, leads: 400, revenue: 150_000, roas: 1.0 },
  { name: 'Story 03', spend: 60_000, leads: 90, revenue: 320_000, roas: 5.3 },
];

const REVENUE_PATH =
  'M0,86 L40,78 L80,82 L120,64 L160,68 L200,48 L240,52 L280,34 L320,38 L360,20 L400,14';
const SPEND_PATH =
  'M0,96 L40,94 L80,97 L120,90 L160,93 L200,86 L240,89 L280,84 L320,87 L360,80 L400,78';

export function DashboardMockup() {
  return (
    <div
      className="edge-top overflow-hidden rounded-card border border-line bg-surface shadow-2xl shadow-black/60"
      role="img"
      aria-label="Пример кабинета Lidera: KPI, динамика выручки и таблица эффективности креативов"
    >
      {/* Строка окна */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 text-[12px] text-faint">lidera.kz / dashboard</span>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {KPI.map((item) => (
            <div
              key={item.label}
              className={`rounded-panel border p-3 ${
                item.accent ? 'border-lime/30 bg-lime/[0.07]' : 'border-line bg-surface-2'
              }`}
            >
              <p className="text-[11px] text-muted">{item.label}</p>
              <p
                className={`tabular mt-1.5 text-[15px] font-semibold sm:text-[17px] ${
                  item.accent ? 'text-lime' : 'text-ink'
                }`}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-panel border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-ink">Выручка и расход</p>
            <ul className="flex items-center gap-4">
              <li className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="h-0.5 w-3.5 rounded-full bg-series-revenue" />
                Выручка
              </li>
              <li className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="h-0.5 w-3.5 rounded-full bg-series-spend" />
                Расход
              </li>
            </ul>
          </div>

          <svg
            viewBox="0 0 400 110"
            preserveAspectRatio="none"
            className="mt-3 h-28 w-full"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="mockup-revenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-series-revenue)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--color-series-revenue)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[22, 55, 88].map((y) => (
              <line
                key={y}
                x1="0"
                x2="400"
                y1={y}
                y2={y}
                stroke="var(--color-line)"
                strokeWidth="0.7"
              />
            ))}
            <path d={`${REVENUE_PATH} L400,110 L0,110 Z`} fill="url(#mockup-revenue)" />
            <path
              d={SPEND_PATH}
              fill="none"
              stroke="var(--color-series-spend)"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={REVENUE_PATH}
              fill="none"
              stroke="var(--color-series-revenue)"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>

        <div className="overflow-hidden rounded-panel border border-line bg-surface-2">
          <div className="border-b border-line px-4 py-2.5">
            <p className="text-[13px] font-medium text-ink">Эффективность креативов</p>
          </div>
          <table className="w-full text-left text-[12px]">
            <thead className="text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Креатив</th>
                <th className="px-2 py-2 text-right font-medium">Расход</th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Лиды</th>
                <th className="px-2 py-2 text-right font-medium">Выручка</th>
                <th className="px-4 py-2 text-right font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {CREATIVES.map((creative) => (
                <tr key={creative.name}>
                  <td className="px-4 py-2.5 text-ink">{creative.name}</td>
                  <td className="tabular px-2 py-2.5 text-right text-ink-soft">
                    {formatMoney(creative.spend, { compact: true })}
                  </td>
                  <td className="tabular hidden px-2 py-2.5 text-right text-ink-soft sm:table-cell">
                    {creative.leads}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right text-ink-soft">
                    {formatMoney(creative.revenue, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`tabular rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                        creative.roas >= 2
                          ? 'bg-positive/12 text-positive'
                          : 'bg-negative/12 text-negative'
                      }`}
                    >
                      {formatRatio(creative.roas)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
