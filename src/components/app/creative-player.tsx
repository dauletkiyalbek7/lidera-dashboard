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
 *
 * Не каждый ролик Meta отдаёт файлом: видео из поста страницы принадлежит
 * странице, а не кабинету. Тогда показываем предпросмотр объявления — рамку
 * самой Meta, в которой оно выглядит как в ленте (см. /api/creatives/…/preview).
 */

type Preview = { src: string; width: number; height: number };

/** cover — обложка; video — ролик файлом; preview — рамка Meta; failed — не вышло. */
type Mode = 'cover' | 'video' | 'preview' | 'failed';

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
  const [mode, setMode] = useState<Mode>('cover');
  const [preview, setPreview] = useState<Preview | null>(null);

  async function showPreview() {
    setMode('preview');

    try {
      const response = await fetch(`/api/creatives/${creativeId}/preview`);
      const payload = (await response.json()) as Partial<Preview>;

      if (!response.ok || !payload.src) throw new Error('нет предпросмотра');

      setPreview({
        src: payload.src,
        width: payload.width ?? 320,
        height: payload.height ?? 525,
      });
    } catch {
      setMode('failed');
    }
  }

  // Рамка Meta своего размера и под пропорции обложки не подстраивается.
  if (mode === 'preview' && preview) {
    return (
      <div className="flex justify-center overflow-hidden rounded-panel border border-line bg-surface-2">
        <iframe
          src={preview.src}
          title={name}
          width={preview.width}
          height={preview.height}
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="max-w-full border-0"
        />
      </div>
    );
  }

  // Картинки нет, ролика нет — объявление всё равно можно посмотреть рамкой.
  const canPlay = hasVideo || !thumbnailUrl;

  return (
    <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-panel border border-line bg-surface-2">
      {mode === 'video' ? (
        <video
          src={`/api/creatives/${creativeId}/media`}
          poster={thumbnailUrl ?? undefined}
          controls
          autoPlay
          playsInline
          onError={showPreview}
          className="size-full object-contain"
        />
      ) : thumbnailUrl ? (
        // Обложка из рекламного кабинета как есть: не режем и не растягиваем.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt={name} className="size-full object-contain" />
      ) : (
        <span className="text-[13px] text-faint">
          {mode === 'failed' ? 'Meta не отдала это объявление' : 'Без изображения'}
        </span>
      )}

      {mode === 'preview' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-[13px] text-white">
          Загружаем объявление…
        </span>
      ) : null}

      {mode === 'failed' && thumbnailUrl ? (
        <span className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-center text-[13px] text-white">
          Meta не отдала это объявление
        </span>
      ) : null}

      {canPlay && mode === 'cover' ? (
        <button
          type="button"
          onClick={() => (hasVideo ? setMode('video') : showPreview())}
          aria-label={hasVideo ? 'Смотреть видео' : 'Показать объявление'}
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
