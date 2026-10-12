-- Группа Telegram для клиентов, написавших не с рекламы.
--
-- В WhatsApp пишут не только с объявлений: по ссылке из шапки профиля, из
-- сторис, из канала или просто найдя номер. Это отдельный поток — с контента,
-- — и следить за ним хотят в общем чате, а не в личных карточках менеджеров.
--
-- Группу привязывает сам человек командой /leads с кодом проекта — той же
-- схемой, что и группу для отчётов. Одна группа на проект: повторная команда
-- в другом чате переносит поток туда.
alter table public.companies
  add column if not exists lead_chat_id bigint,
  add column if not exists lead_chat_title text,
  add column if not exists organic_handout boolean not null default true;

comment on column public.companies.lead_chat_id is
  'Группа Telegram, куда уходят клиенты, написавшие в WhatsApp не с рекламы.';
comment on column public.companies.lead_chat_title is
  'Название этой группы — чтобы в кабинете было видно, куда уходят карточки.';
comment on column public.companies.organic_handout is
  'Отдавать ли таких клиентов авто-раздаче. false — только в группу, менеджерам лично не уходят.';
