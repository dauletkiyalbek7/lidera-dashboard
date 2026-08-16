import type { CSSProperties, ReactNode } from 'react';

/** Табличные примитивы кабинета — одна геометрия на всех разделах. */

/**
 * С какой ширины экрана колонка появляется.
 *
 * Широкая таблица на ноутбуке уезжает вправо, и первым исчезает не самое
 * ненужное, а самое правое — например «Ответственный». Поэтому колонки
 * второго ряда важности прячем сами, а не отдаём горизонтальной прокрутке.
 */
export type ColumnBreakpoint = 'md' | 'lg' | 'xl';

/** Классы перечислены целиком: Tailwind ищет их в исходниках по тексту. */
const SHOW_FROM: Record<ColumnBreakpoint, string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

export type TableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Колонка видна только с этой ширины экрана. */
  showFrom?: ColumnBreakpoint;
};

/**
 * Минимальная ширина таблицы. Числом — если колонки не прячутся; объектом —
 * по одной ширине на каждый набор видимых колонок.
 */
type MinWidth = number | { base: number; md?: number; lg?: number; xl?: number };

function minWidthVars(minWidth: MinWidth): CSSProperties {
  const steps = typeof minWidth === 'number' ? { base: minWidth } : minWidth;
  const { base } = steps;
  return {
    '--table-min': `${base}px`,
    '--table-min-md': `${steps.md ?? base}px`,
    '--table-min-lg': `${steps.lg ?? steps.md ?? base}px`,
    '--table-min-xl': `${steps.xl ?? steps.lg ?? steps.md ?? base}px`,
  } as CSSProperties;
}

export function TableShell({
  columns,
  children,
  minWidth = 720,
}: {
  columns: TableColumn[];
  children: ReactNode;
  minWidth?: MinWidth;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-left text-[13.5px] min-w-[var(--table-min)] md:min-w-[var(--table-min-md)] lg:min-w-[var(--table-min-lg)] xl:min-w-[var(--table-min-xl)]"
        style={minWidthVars(minWidth)}
      >
        <thead className="border-b border-line text-[12.5px] text-muted">
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                className={`py-3 font-medium ${
                  column.align === 'right' ? 'text-right' : 'text-left'
                } ${index === 0 ? 'pl-5 pr-3 sm:pl-6' : ''} ${
                  index === columns.length - 1 ? 'pl-3 pr-5 sm:pr-6' : 'px-3'
                } ${column.showFrom ? SHOW_FROM[column.showFrom] : ''}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  align = 'left',
  first = false,
  last = false,
  showFrom,
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  first?: boolean;
  last?: boolean;
  /** То же значение, что у колонки в шапке: ячейка прячется вместе с ней. */
  showFrom?: ColumnBreakpoint;
  className?: string;
}) {
  return (
    <td
      className={`py-3.5 ${align === 'right' ? 'text-right' : 'text-left'} ${
        first ? 'pl-5 pr-3 sm:pl-6' : last ? 'pl-3 pr-5 sm:pr-6' : 'px-3'
      } ${showFrom ? SHOW_FROM[showFrom] : ''} ${className}`}
    >
      {children}
    </td>
  );
}
