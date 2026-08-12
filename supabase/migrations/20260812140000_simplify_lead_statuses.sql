-- =============================================================================
-- Lidera Final — упрощение статусов лида
--
-- «Целевой» и «Нецелевой» оказались лишними: менеджеру важен результат
-- контакта, а не оценка качества лида. Существующие записи переносим:
--   qualified -> contacted  (разговор состоялся)
--   invalid   -> rejected   (лид не пойдёт дальше)
--
-- Заодно уточняются подписи: no_answer читается как «Игнор» — человек
-- не отвечает, а contacted как «Дозвон». В базе ключи не меняются.
-- =============================================================================

update public.leads set status = 'contacted' where status = 'qualified';
update public.leads set status = 'rejected'  where status = 'invalid';

alter table public.leads drop constraint leads_status_check;

alter table public.leads add constraint leads_status_check
  check (status in (
    'new',
    'no_answer',
    'contacted',
    'in_progress',
    'thinking',
    'trial',
    'sale',
    'rejected'
  ));
