-- Заявки и переписки — разные вещи, и складывать их в одно число неверно.
--
-- Заявка это заполненная форма: человек оставил телефон, и он же приходит в
-- CRM. Переписка — написавший в WhatsApp, до CRM он не доходит. Смешанное
-- число не сходилось ни с кабинетом, ни с разделом «Лиды», и цена лида по нему
-- получалась выдуманной.
--
-- leads теперь значит «заявки», переписки живут отдельной колонкой.
alter table ad_metrics add column conversations integer not null default 0;

comment on column ad_metrics.leads is 'Заявки с формы — то же, что «Лиды» в Ads Manager';
comment on column ad_metrics.conversations is 'Начатые переписки в WhatsApp: в CRM они не попадают';

update ad_metrics set conversations = 0 where conversations <> 0;
