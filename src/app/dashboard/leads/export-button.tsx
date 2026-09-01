'use client';

import { useSearchParams } from 'next/navigation';

import { ButtonLink } from '@/components/ui/button';

/**
 * Выгрузка заявок за период.
 *
 * Постраничный список хорош, чтобы смотреть, но не чтобы считать: за месяц
 * заявок под две тысячи, и разбирать их удобнее в таблице. Кнопка отдаёт весь
 * период целиком — с теми же фильтрами, что видны на экране.
 *
 * Обычная ссылка, а не запрос из скрипта: браузер сам покажет прогресс и
 * положит файл в загрузки, а мы не держим весь список в памяти вкладки.
 */
export function ExportLeadsButton({ total }: { total: number }) {
  const searchParams = useSearchParams();

  // Страница и её размер к выгрузке не относятся: файл всегда за весь период.
  const params = new URLSearchParams(searchParams.toString());
  params.delete('page');
  params.delete('perPage');
  params.delete('q');

  const query = params.toString();

  return (
    <ButtonLink
      href={query ? `/api/leads/export?${query}` : '/api/leads/export'}
      variant="secondary"
      aria-disabled={total === 0}
    >
      Выгрузить
    </ButtonLink>
  );
}
