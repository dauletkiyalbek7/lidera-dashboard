-- =============================================================================
-- Lidera Final — пробное занятие уходит продажнику
--
-- В воронке с пробными работают двое: менеджер дозванивается и записывает,
-- продажник проводит занятие и закрывает продажу. До сих пор цепочка рвалась
-- ровно посередине: менеджер ставил «Пробный», и дальше номер никуда не шёл —
-- продажник узнавал о занятии на словах.
--
-- Теперь у пробного есть свой ответственный, и раздаётся он по тем же
-- правилам, что и лиды: поровну между продажниками на смене, без отъёма.
-- =============================================================================

alter table public.trials
  add column assigned_to uuid references public.employees (id) on delete set null,
  add column assigned_at timestamptz;

comment on column public.trials.assigned_to is
  'Продажник, который проводит занятие. Раздаётся автоматически.';

-- Очередь нераспределённых пробных ищется именно этим запросом.
create index trials_unassigned_idx on public.trials (company_id, created_at)
  where assigned_to is null and status = 'scheduled';

create index trials_assigned_idx on public.trials (assigned_to, date)
  where assigned_to is not null;
