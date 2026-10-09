-- Отчёт в группу: отметка «доставлено» отдельно от отметки о попытке.
--
-- Раньше строка в report_deliveries появлялась до отправки и означала сразу
-- всё: и «взялись», и «отправили». Если функцию обрывали посередине — а на
-- сводном отчёте с походом в Meta это случалось, — строка оставалась, группа
-- не получала ничего, и повторить было некому: за этот день отчёт числился
-- отправленным.
--
-- Теперь sent_at — начало последней попытки, delivered_at — момент, когда
-- Telegram принял сообщение. Попытку без delivered_at планировщик повторяет.

alter table public.report_deliveries
  add column if not exists delivered_at timestamptz,
  add column if not exists attempts integer not null default 1,
  add column if not exists last_error text;

-- Про старые строки уже не узнать, дошли ли они, — считаем доставленными,
-- иначе планировщик взялся бы рассылать сегодняшние отчёты заново.
update public.report_deliveries
   set delivered_at = sent_at
 where delivered_at is null;
