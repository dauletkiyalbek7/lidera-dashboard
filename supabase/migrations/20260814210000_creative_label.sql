-- Короткое имя ролика.
--
-- Meta называет объявления как придётся: «Напишите нам», «Новое объявление с
-- целью „Лиды" — Копия». В таблице такое имя занимает пол-экрана и ничего не
-- объясняет. Платформа подписывает ролики «Видео 1», «Видео 2», а директор
-- может задать своё имя.

alter table public.creatives
  add column if not exists label text;

comment on column public.creatives.label is
  'Короткое имя ролика для отчётов. Пусто — платформа подписывает «Видео N».';

drop policy if exists creatives_update_own on public.creatives;
create policy creatives_update_own on public.creatives
  for update using (private.is_super_admin() or company_id = private.current_company_id())
  with check (private.is_super_admin() or company_id = private.current_company_id());
