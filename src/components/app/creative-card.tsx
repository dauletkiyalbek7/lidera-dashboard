'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';
import type { CreativeCard as CreativeCardData } from '@/lib/queries';

/**
 * Карточка креатива: сам ролик и его цифры рядом.
 *
 * Медиа показываем целиком (`object-contain`) и в исходных пропорциях —
 * обрезка «по центру» режет людям лица, а именно лицо в кадре чаще всего и
 * есть креатив.
 *
 * Видео не грузим сразу: их на странице десятки, и автозагрузка съела бы
 * трафик клиента. Первый кадр — обложка, ролик подключается по клику.
 */
export function CreativeCard({
  creative,
  currency,
}: {
  creative: CreativeCardData;
  currency: string;
}) {
  const [playing, setPlaying] = useState(false);

  const status =
    creative.status === 'active'
      ? { label: 'Активен', tone: 'positive' as const }
      : creative.status === 'paused'
        ? { label: 'На паузе', tone: 'warning' as const }
        : { label: 'В архиве', tone: 'neutral' as const };

  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      <div className="relative flex aspect-[4/5] items-center justify-center bg-surface-2">
        {playing && creative.hasVideo ? (
          <video
            src={`/api/creatives/${creative.id}/media`}
            poster={creative.thumbnailUrl ?? undefined}
            controls
            autoPlay
            playsInline
            className="size-full object-contain"
          />
        ) : creative.thumbnailUrl ? (
          // Обложка приходит из рекламного кабинета как есть — не режем и не
          // растягиваем, иначе кадр перестаёт быть тем креативом.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={creative.thumbnailUrl}
            alt={creative.name}
            className="size-full object-contain"
            loading="lazy"
          />
        ) : (
          <span className="text-[13px] text-faint">Без изображения</span>
        )}

        {creative.hasVideo && !playing ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Смотреть видео"
            className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/35"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-surface/90 text-ink shadow-lg">
              <svg viewBox="0 0 24 24" className="ml-0.5 size-6" fill="currentColor">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
          </button>
        ) : null}

        <div className="absolute left-3 top-3 flex gap-1.5">
          <Badge tone={status.tone}>{status.label}</Badge>
          {creative.hasVideo ? <Badge tone="neutral">Видео</Badge> : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="line-clamp-2 text-[14px] font-medium text-ink">
          {creative.title || creative.name}
        </p>
        {creative.body ? (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-faint">
            {creative.body}
          </p>
        ) : null}

        {creative.campaigns.length > 0 ? (
          <p className="mt-2 text-[11.5px] text-muted">
            {creative.campaigns.slice(0, 2).join(', ')}
            {creative.numbers.length > 0 ? ` · ${creative.numbers.join(', ')}` : ''}
          </p>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
          <Metric label="Расход" value={formatMoney(creative.spend, { currency })} />
          <Metric label="Написали" value={formatNumber(creative.conversions)} accent />
          <Metric
            label="Цена"
            value={
              creative.conversions
                ? formatMoney(creative.costPerConversion, { currency })
                : '—'
            }
          />
          <Metric
            label="Клики"
            value={`${formatNumber(creative.clicks)} · ${formatPercent(creative.ctr, 2)}`}
          />
          <Metric label="Показы" value={formatNumber(creative.impressions)} />
          <Metric
            label="Продажи"
            value={
              creative.sales
                ? `${formatNumber(creative.sales)} · ${formatMoney(creative.revenue, { currency })}`
                : '0'
            }
          />
        </dl>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11.5px] text-faint">{label}</dt>
      <dd
        className={`tabular mt-0.5 text-[14px] font-medium ${accent ? 'text-lime' : 'text-ink'}`}
      >
        {value}
      </dd>
    </div>
  );
}
