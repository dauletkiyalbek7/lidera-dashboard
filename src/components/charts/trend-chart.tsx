'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatDateShort, formatMoney } from '@/lib/format';

export type TrendPoint = {
  date: string;
  revenue: number;
  spend: number;
};

const SERIES = [
  { key: 'revenue', label: 'Выручка', color: 'var(--color-series-revenue)' },
  { key: 'spend', label: 'Расход', color: 'var(--color-series-spend)' },
] as const;

const HEIGHT = 280;
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };

/**
 * Динамика выручки и расхода. Обе серии — деньги в тенге, поэтому шкала одна:
 * вторая ось Y здесь была бы выдумкой, а не информацией.
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const innerWidth = Math.max(1, width - PADDING.left - PADDING.right);
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const peak = Math.max(1, ...data.flatMap((d) => [d.revenue, d.spend]));
    const ceiling = niceCeiling(peak);

    const x = (index: number) =>
      PADDING.left +
      (data.length <= 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth);
    const y = (value: number) =>
      PADDING.top + innerHeight - (value / ceiling) * innerHeight;

    return { innerWidth, innerHeight, ceiling, x, y };
  }, [data, width]);

  const handlePointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (data.length === 0) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const offset = event.clientX - bounds.left - PADDING.left;
      const step = geometry.innerWidth / Math.max(1, data.length - 1);
      const index = Math.round(offset / step);
      setHoverIndex(Math.min(data.length - 1, Math.max(0, index)));
    },
    [data.length, geometry.innerWidth],
  );

  if (data.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-sm text-muted">
        За выбранный период данных нет.
      </p>
    );
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => geometry.ceiling * ratio);
  const active = hoverIndex === null ? null : data[hoverIndex];

  return (
    <div className="px-5 pb-5 pt-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Легенда обязательна при двух и более сериях */}
        <ul className="flex flex-wrap items-center gap-4">
          {SERIES.map((series) => (
            <li key={series.key} className="flex items-center gap-2 text-[13px] text-ink-soft">
              <span
                className="h-0.5 w-4 rounded-full"
                style={{ background: series.color }}
                aria-hidden="true"
              />
              {series.label}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setShowTable((value) => !value)}
          className="rounded-control border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
        >
          {showTable ? 'Показать график' : 'Показать таблицей'}
        </button>
      </div>

      {showTable ? (
        <TrendTable data={data} />
      ) : (
        <div ref={containerRef} className="relative">
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label="График выручки и рекламного расхода по дням"
            className="touch-none select-none"
            onPointerMove={handlePointer}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <defs>
              {SERIES.map((series) => (
                <linearGradient
                  key={series.key}
                  id={`fill-${series.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={series.color} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={series.color} stopOpacity="0.01" />
                </linearGradient>
              ))}
            </defs>

            {/* Сетка: тонкая, сплошная, на шаг от поверхности */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PADDING.left}
                  x2={width - PADDING.right}
                  y1={geometry.y(tick)}
                  y2={geometry.y(tick)}
                  stroke="var(--color-line)"
                  strokeWidth="1"
                />
                <text
                  x={PADDING.left - 10}
                  y={geometry.y(tick) + 4}
                  textAnchor="end"
                  className="tabular"
                  fontSize="11"
                  fill="var(--color-faint)"
                >
                  {compactTick(tick)}
                </text>
              </g>
            ))}

            {SERIES.map((series) => {
              const points = data.map((point, index) => ({
                x: geometry.x(index),
                y: geometry.y(point[series.key]),
              }));
              const line = points
                .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                .join(' ');
              const baseline = geometry.y(0);
              const area = `${line} L${points.at(-1)!.x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`;

              return (
                <g key={series.key}>
                  <path d={area} fill={`url(#fill-${series.key})`} />
                  <path
                    d={line}
                    fill="none"
                    stroke={series.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

            {/* Подписи дат: только крайние и середина — иначе каша */}
            {[0, Math.floor((data.length - 1) / 2), data.length - 1]
              .filter((index, position, all) => all.indexOf(index) === position)
              .map((index) => (
                <text
                  key={index}
                  x={geometry.x(index)}
                  y={HEIGHT - 8}
                  textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
                  fontSize="11"
                  fill="var(--color-faint)"
                >
                  {formatDateShort(data[index].date)}
                </text>
              ))}

            {hoverIndex !== null ? (
              <g>
                <line
                  x1={geometry.x(hoverIndex)}
                  x2={geometry.x(hoverIndex)}
                  y1={PADDING.top}
                  y2={HEIGHT - PADDING.bottom}
                  stroke="var(--color-line-strong)"
                  strokeWidth="1"
                />
                {SERIES.map((series) => (
                  <circle
                    key={series.key}
                    cx={geometry.x(hoverIndex)}
                    cy={geometry.y(data[hoverIndex][series.key])}
                    r="4.5"
                    fill={series.color}
                    stroke="var(--color-surface)"
                    strokeWidth="2"
                  />
                ))}
              </g>
            ) : null}
          </svg>

          {active ? (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-panel border border-line-strong bg-surface-2/95 p-3 shadow-xl backdrop-blur"
              style={{
                left: Math.min(
                  Math.max(geometry.x(hoverIndex!) - 88, 0),
                  Math.max(0, width - 190),
                ),
              }}
            >
              <p className="text-[12px] text-muted">{formatDateShort(active.date)}</p>
              <dl className="mt-2 space-y-1.5">
                {SERIES.map((series) => (
                  <div key={series.key} className="flex items-center justify-between gap-4">
                    <dt className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: series.color }}
                        aria-hidden="true"
                      />
                      {series.label}
                    </dt>
                    <dd className="tabular text-[12.5px] font-medium text-ink">
                      {formatMoney(active[series.key], { compact: true })}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TrendTable({ data }: { data: TrendPoint[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-panel border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-surface-2 text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Дата</th>
            <th className="px-4 py-2.5 text-right font-medium">Выручка</th>
            <th className="px-4 py-2.5 text-right font-medium">Расход</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((point) => (
            <tr key={point.date}>
              <td className="px-4 py-2.5 text-ink-soft">{formatDateShort(point.date)}</td>
              <td className="tabular px-4 py-2.5 text-right text-ink">
                {formatMoney(point.revenue)}
              </td>
              <td className="tabular px-4 py-2.5 text-right text-ink">
                {formatMoney(point.spend)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Округляет верх шкалы до «человеческого» числа. */
function niceCeiling(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function compactTick(value: number): string {
  if (value === 0) return '0';
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10} млн`;
  if (value >= 1000) return `${Math.round(value / 1000)} тыс`;
  return String(Math.round(value));
}
