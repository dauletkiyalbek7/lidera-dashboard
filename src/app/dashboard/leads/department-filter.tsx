import Link from 'next/link';

/**
 * Переключатель отделов продаж.
 *
 * У проекта бывает несколько отделов, и каждый смотрит свои заявки: общий
 * список из шести тысяч строк не отвечает на вопрос «сколько сегодня у
 * Алибека». Ссылками, а не выпадающим списком: выбранный отдел виден сразу и
 * остаётся в адресе, так что ссылку можно отправить руководителю.
 *
 * Период и поиск переносим как есть — переключение отдела не должно сбрасывать
 * то, что человек уже выбрал.
 */
export function DepartmentFilter({
  departments,
  selected,
  params,
}: {
  departments: { id: string; name: string }[];
  selected: string | null;
  params: { period?: string; from?: string; to?: string; q?: string };
}) {
  if (departments.length < 2) return null;

  const href = (id: string | null) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) next.set(key, value);
    }
    if (id) next.set('department', id);

    const query = next.toString();
    return query ? `/dashboard/leads?${query}` : '/dashboard/leads';
  };

  const items = [{ id: null, name: 'Все отделы' }, ...departments];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const active = item.id === selected;

        return (
          <Link
            key={item.id ?? 'all'}
            href={href(item.id)}
            className={`flex h-10 items-center rounded-control border px-3.5 text-[13.5px] transition-colors ${
              active
                ? 'border-lime bg-lime/10 font-medium text-lime-strong'
                : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
            }`}
          >
            {item.name}
          </Link>
        );
      })}
    </div>
  );
}
