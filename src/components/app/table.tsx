import type { ReactNode } from 'react';

/** Табличные примитивы кабинета — одна геометрия на всех разделах. */

export function TableShell({
  columns,
  children,
  minWidth = 720,
}: {
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-left text-[13.5px]"
        style={{ minWidth: `${minWidth}px` }}
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
                }`}
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
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  first?: boolean;
  last?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`py-3.5 ${align === 'right' ? 'text-right' : 'text-left'} ${
        first ? 'pl-5 pr-3 sm:pl-6' : last ? 'pl-3 pr-5 sm:pr-6' : 'px-3'
      } ${className}`}
    >
      {children}
    </td>
  );
}
