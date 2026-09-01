'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Переключатель отделов продаж — один на все разделы.
 *
 * У проекта бывает несколько отделов, и руководитель смотрит их порознь:
 * общий итог не отвечает на вопрос «сколько сегодня у Алибека». Выбор живёт
 * в адресе, поэтому переживает смену периода и его можно отправить ссылкой.
 *
 * Кнопки переключают страницу сами, а не ссылками: сервер собирает раздел
 * несколько секунд, и всё это время человеку нужно видеть, что нажатие
 * дошло. Нажатый отдел подсвечивается сразу, ряд притухает — ожидание
 * становится понятным, а не похожим на зависший экран.
 */
export function DepartmentFilter({
  departments,
  selected,
}: {
  departments: { id: string; name: string }[];
  selected: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Куда нажали. Пока сервер думает, подсвечиваем именно этот отдел, а не тот,
  // что ещё стоит в адресе.
  const [target, setTarget] = useState<string | null>(null);

  if (departments.length < 2) return null;

  const go = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('department', id);
    else params.delete('department');

    // Отдел меняет длину списка, поэтому листаем с начала: страницы 12 у
    // отдела может уже не быть.
    params.delete('page');

    const query = params.toString();
    setTarget(id);
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  const shown = pending ? target : selected;
  const items = [{ id: null, name: 'Все отделы' }, ...departments];

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${pending ? 'opacity-70' : ''}`}>
      {items.map((item) => {
        const active = item.id === shown;

        return (
          <button
            key={item.id ?? 'all'}
            type="button"
            onClick={() => go(item.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex h-10 items-center rounded-control border px-3.5 text-[13.5px] transition-colors ${
              active
                ? 'border-lime bg-lime/10 font-medium text-lime-strong'
                : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
            }`}
          >
            {item.name}
          </button>
        );
      })}
    </div>
  );
}
