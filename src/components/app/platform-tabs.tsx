'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Вкладки площадок: Meta и TikTok порознь.
 *
 * Сравнивать кампании и ролики двух площадок в одном списке бессмысленно —
 * у них разные аукционы и разная цена показа, и рядом они создают ложное
 * «эта площадка дороже». Смотреть надо внутри площадки, поэтому вкладка, а не
 * колонка.
 *
 * Выбор живёт в адресе: переживает смену периода и отправляется ссылкой.
 * Переключаем кнопкой, а не ссылкой, по той же причине, что и отделы: сервер
 * собирает раздел несколько секунд, и всё это время должно быть видно, что
 * нажатие дошло.
 */
export function PlatformTabs({
  platforms,
  selected,
}: {
  /** Только те площадки, по которым у компании есть кабинет. */
  platforms: { key: string; label: string }[];
  selected: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  // Одна площадка — выбирать не из чего, и вкладка только отнимает место.
  if (platforms.length < 2) return null;

  const go = (key: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key) params.set('platform', key);
    else params.delete('platform');

    // Площадка меняет длину списка — листаем с начала.
    params.delete('page');

    const query = params.toString();
    setTarget(key);
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  };

  const shown = pending ? target : selected;
  const items = [{ key: null as string | null, label: 'Все площадки' }, ...platforms];

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${pending ? 'opacity-70' : ''}`}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.key === shown;

        return (
          <button
            key={item.key ?? 'all'}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => go(item.key)}
            className={`flex h-10 items-center rounded-control border px-3.5 text-[13.5px] transition-colors ${
              active
                ? 'border-lime bg-lime/10 font-medium text-lime-strong'
                : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** Подписи площадок — общие для «Рекламы» и «Креативов». */
export const PLATFORM_TAB_LABELS: Record<string, string> = {
  meta: 'Meta Ads',
  tiktok: 'TikTok Ads',
  google: 'YouTube',
  other: 'Другие',
};
