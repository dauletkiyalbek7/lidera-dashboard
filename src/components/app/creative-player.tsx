'use client';

import { useState } from 'react';

/**
 * Проигрыватель креатива.
 *
 * Медиа показываем целиком (`object-contain`) и в исходных пропорциях —
 * обрезка «по центру» режет людям лица, а лицо в кадре чаще всего и есть
 * креатив.
 *
 * Ролик подключается по нажатию: пока висит обложка, трафик не тратится.
 */
export function CreativePlayer({
  creativeId,
  thumbnailUrl,
  hasVideo,
  name,
}: {
  creativeId: string;
  thumbnailUrl: string | null;
  hasVideo: boolean;
  name: string;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-panel border border-line bg-surface-2">
      {playing && hasVideo ? (
        <video
          src={`/api/creatives/${creativeId}/media`}
          poster={thumbnailUrl ?? undefined}
          controls
          autoPlay
          playsInline
          className="size-full object-contain"
        />
      ) : thumbnailUrl ? (
        // Обложка из рекламного кабинета как есть: не режем и не растягиваем.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt={name} className="size-full object-contain" />
      ) : (
        <span className="text-[13px] text-faint">Без изображения</span>
      )}

      {hasVideo && !playing ? (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label="Смотреть видео"
          className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/35"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-surface/90 text-ink shadow-lg">
            <svg viewBox="0 0 24 24" className="ml-1 size-7" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
        </button>
      ) : null}
    </div>
  );
}
