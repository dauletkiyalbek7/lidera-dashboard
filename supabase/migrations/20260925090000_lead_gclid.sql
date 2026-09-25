-- Метка клика Google — то же, чем для Meta служит fbc.
--
-- Без неё покупку невозможно вернуть в Google Ads: кабинет узнаёт клиента
-- только по номеру клика, телефон и почта ему для этого не годятся.
alter table leads add column if not exists gclid text;

comment on column leads.gclid is
  'Номер клика Google Ads. Приходит в адресе страницы при включённой автопометке.';
