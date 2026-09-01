'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { IconDownload } from '@/components/ui/icons';

/**
 * Выгрузка заявок за период.
 *
 * Постраничный список хорош, чтобы смотреть, но не чтобы считать: за месяц
 * заявок под две тысячи, и разбирать их удобнее в таблице. Кнопка отдаёт весь
 * период целиком — с теми же фильтрами, что видны на экране.
 *
 * Обычная ссылка, а не запрос из скрипта: браузер сам покажет прогресс и
 * положит файл в загрузки, а мы не держим весь список в памяти вкладки.
 *
 * Живёт в одной рамке с выбором периода: экспорт всегда за тот период, что
 * выбран рядом, и рядом их читать правильнее, чем порознь.
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
    <Link
      href={query ? `/api/leads/export?${query}` : '/api/leads/export'}
      aria-disabled={total === 0}
      className="flex h-10 items-center gap-2 rounded-l-control px-3.5 text-[13.5px] text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <IconDownload className="size-4" />
      Экспорт
    </Link>
  );
}
