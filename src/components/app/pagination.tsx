'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Постраничный вывод длинных списков.
 *
 * За месяц у Дарына набегает под две тысячи заявок — одной страницей это ни
 * открыть, ни просмотреть. Номер страницы и размер живут в адресе: ссылку на
 * нужную страницу можно отправить, а возврат «назад» в браузере работает сам.
 *
 * Номеров показываем не все: у сотни страниц их ряд не помещается ни на одном
 * экране. Видны края, соседи текущей и многоточие вместо остального.
 */
export function Pagination({
  page,
  total,
  perPage,
  perPageOptions,
}: {
  page: number;
  total: number;
  perPage: number;
  perPageOptions: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);

  const go = (next: number, size = perPage) => {
    const params = new URLSearchParams(searchParams.toString());

    // Первую страницу и размер по умолчанию в адрес не пишем: короткая ссылка
    // читается лучше, а значение всё равно то же самое.
    if (next > 1) params.set('page', String(next));
    else params.delete('page');

    if (size !== perPageOptions[1]) params.set('perPage', String(size));
    else params.delete('perPage');

    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  if (total <= perPageOptions[0] && pages === 1) return null;

  const from = (current - 1) * perPage + 1;
  const to = Math.min(current * perPage, total);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 sm:px-6 ${
        pending ? 'opacity-60' : ''
      }`}
    >
      <p className="text-[12.5px] text-muted">
        Показаны <span className="tabular text-ink-soft">{from}</span>–
        <span className="tabular text-ink-soft">{to}</span> из{' '}
        <span className="tabular text-ink-soft">{total}</span>
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Step label="‹" disabled={current === 1} onClick={() => go(current - 1)} />

        {pageNumbers(current, pages).map((item, index) =>
          item === null ? (
            <span key={`gap-${index}`} className="px-1 text-[13px] text-faint">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => go(item)}
              aria-current={item === current ? 'page' : undefined}
              className={`h-9 min-w-9 rounded-control border px-2.5 text-[13px] tabular transition-colors ${
                item === current
                  ? 'border-lime bg-lime/10 font-medium text-lime-strong'
                  : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
              }`}
            >
              {item}
            </button>
          ),
        )}

        <Step label="›" disabled={current === pages} onClick={() => go(current + 1)} />

        <select
          value={perPage}
          onChange={(event) => go(1, Number(event.target.value))}
          className="ml-1 h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink-soft transition-colors hover:border-line-strong"
          aria-label="Строк на странице"
        >
          {perPageOptions.map((size) => (
            <option key={size} value={size}>
              {size} на странице
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Step({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 min-w-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-line"
    >
      {label}
    </button>
  );
}

/** Края, соседи текущей страницы и многоточие вместо остального. */
function pageNumbers(current: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);

  const shown = new Set([1, pages, current, current - 1, current + 1]);
  const result: (number | null)[] = [];
  let gap = false;

  for (let page = 1; page <= pages; page += 1) {
    if (shown.has(page)) {
      result.push(page);
      gap = false;
    } else if (!gap) {
      result.push(null);
      gap = true;
    }
  }

  return result;
}
