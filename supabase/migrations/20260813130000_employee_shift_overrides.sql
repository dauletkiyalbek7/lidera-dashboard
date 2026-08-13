-- =============================================================================
-- Lidera Final — индивидуальные настройки смены и графика
--
-- Одна компания держит и офисных, и удалённых менеджеров, и графики у них
-- разные. Поэтому настройки компании становятся значением по умолчанию,
-- а у сотрудника появляется личное переопределение.
--
-- NULL здесь означает «как в компании», а не «пусто»: так директор меняет
-- правило один раз в настройках, и оно применяется ко всем, у кого нет
-- личного исключения.
-- =============================================================================

alter table public.employees
  add column shift_mode text
    check (shift_mode is null or shift_mode in ('always', 'shift', 'geo')),
  add column work_start_time time,
  add column late_grace_minutes int
    check (late_grace_minutes is null or late_grace_minutes between 0 and 120);

comment on column public.employees.shift_mode is
  'Личный режим смены. NULL — использовать режим компании.';
comment on column public.employees.work_start_time is
  'Личное начало рабочего дня. NULL — как в компании.';
comment on column public.employees.late_grace_minutes is
  'Личный допуск опоздания в минутах. NULL — как в компании.';
