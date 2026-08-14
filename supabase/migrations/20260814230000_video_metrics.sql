-- Как смотрят ролик.
--
-- Расход и лиды говорят, сработал ли креатив, но не почему. Досмотры и среднее
-- время показывают, где человек уходит: на первой секунде или у призыва.

alter table public.ad_metrics
  add column if not exists video_plays bigint not null default 0,
  add column if not exists video_completions bigint not null default 0,
  add column if not exists video_avg_seconds numeric(10,2) not null default 0;

comment on column public.ad_metrics.video_plays is 'Начатые просмотры ролика.';
comment on column public.ad_metrics.video_completions is 'Досмотры до конца.';
comment on column public.ad_metrics.video_avg_seconds is 'Среднее время просмотра, секунды.';
