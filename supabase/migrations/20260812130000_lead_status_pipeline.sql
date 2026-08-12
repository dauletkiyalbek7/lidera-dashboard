-- =============================================================================
-- Lidera Final — расширенный статус лида
--
-- Менеджер оценивает лид не двумя состояниями, а результатом контакта:
-- дозвонился или нет, целевой или нет, думает или отказал. Прежний набор
-- (new / in_progress / qualified / trial / sale / rejected) сохраняем целиком,
-- поэтому существующие строки менять не нужно — только расширяем CHECK.
--
--   no_answer  — трубку не берут (попытка была, контакта нет)
--   contacted  — дозвонились, разговор состоялся
--   thinking   — взял паузу на решение
--   invalid    — нецелевой: чужой город, ошибочный номер, спам
-- =============================================================================

alter table public.leads drop constraint leads_status_check;

alter table public.leads add constraint leads_status_check
  check (status in (
    'new',
    'no_answer',
    'contacted',
    'in_progress',
    'qualified',
    'thinking',
    'trial',
    'sale',
    'rejected',
    'invalid'
  ));
