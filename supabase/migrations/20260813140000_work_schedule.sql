-- =============================================================================
-- Lidera Final — полный график работы: конец дня и рабочие дни
--
-- Одного времени начала мало: без конца дня непонятно, сколько часов в смене,
-- а без списка рабочих дней система считает опозданием выход в субботу.
--
-- Дни недели храним по ISO: 1 — понедельник, 7 — воскресенье. У сотрудника
-- NULL по-прежнему означает «как в компании».
-- =============================================================================

alter table public.companies
  add column work_end_time time not null default '18:00',
  add column work_days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[]
    check (
      work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      and cardinality(work_days) between 1 and 7
    );

alter table public.employees
  add column work_end_time time,
  add column work_days smallint[]
    check (
      work_days is null
      or (
        work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
        and cardinality(work_days) between 1 and 7
      )
    );

comment on column public.companies.work_end_time is
  'Конец рабочего дня. Меньше начала — ночная смена через полночь.';
comment on column public.companies.work_days is
  'Рабочие дни недели по ISO: 1 — понедельник, 7 — воскресенье.';
comment on column public.employees.work_end_time is
  'Личный конец рабочего дня. NULL — как в компании.';
comment on column public.employees.work_days is
  'Личные рабочие дни. NULL — как в компании.';
