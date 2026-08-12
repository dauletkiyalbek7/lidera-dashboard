# Lidera

Сквозная аналитика рекламы до реальной продажи: Meta Ads и TikTok Ads → лид → пробный →
продажа → выручка. Multi-tenant SaaS на Next.js + Supabase.

Текст исходного ТЗ — в [PROMPT.md](./PROMPT.md).

---

## Быстрый старт

```bash
npm install
cp .env.example .env.local   # заполнить значения, см. ниже
npm run dev                  # http://localhost:3000
```

### Переменные окружения

| Переменная | Где взять | Попадает в браузер |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Lidera Final → Project Settings → API | да |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | там же, ключ `anon` | да |
| `SUPABASE_SERVICE_ROLE_KEY` | там же, ключ `service_role` | **никогда** |
| `NEXT_PUBLIC_SITE_URL` | адрес сайта (для писем восстановления пароля и OG) | да |

`SUPABASE_SERVICE_ROLE_KEY` нужен только админ-панели для создания компаний и учётных
записей директоров. Файл, который его читает, помечен `server-only` — сборка упадёт при
попытке импортировать его в клиентский компонент.

### Демо-доступы

| Роль | Логин | Пароль | Куда попадает |
|---|---|---|---|
| SUPER_ADMIN | `admin@lidera.kz` | `LideraAdmin2026!` | `/admin` |
| DIRECTOR | `director@democompany.kz` | `DemoDirector2026!` | `/dashboard` |

Пароли демонстрационные — смените их перед публичным запуском.

---

## База данных

Проект Supabase — **Lidera Final** (`xnfqsoruxkjhekdklxot`, регион eu-central-1).
Старый проект `lidera` не используется.

```
supabase/
  migrations/
    20260812100000_core_schema.sql        компании, профили, подписки
    20260812100100_ads_schema.sql         кабинеты, кампании, группы, объявления, креативы, метрики
    20260812100200_crm_schema.sql         лиды, пробные, продажи, чеки, интеграции, журнал
    20260812100300_rls.sql                RLS и политики
    20260812110000_harden_rls_helpers.sql перенос служебных функций в схему private
  seed.sql                                демо-компания и 90 дней данных
```

Применить на чистую базу:

```bash
npx supabase link --project-ref xnfqsoruxkjhekdklxot
npx supabase db push
npx supabase db execute --file supabase/seed.sql
```

### Изоляция арендаторов

Каждая строка данных клиента несёт `company_id`. Доступ ограничен политиками Row Level
Security, а не фильтрами в интерфейсе:

* `private.current_company_id()` — компания текущего пользователя;
* `private.is_super_admin()` — платформенный администратор видит всё;
* `private.can_write()` — право записи внутри своей компании.

Функции живут в схеме `private`, поэтому не доступны через `/rest/v1/rpc`, и объявлены
`security definer` — иначе политика на `profiles`, читающая `profiles`, ушла бы в рекурсию.

Проверено на живой базе: директор видит только свою компанию, не может создать компанию
(403) и не может вставить строку с чужим `company_id` (ошибка политики RLS).

---

## Структура кода

```
src/
  app/
    page.tsx                  публичный лендинг
    (marketing)/              контакты, политика конфиденциальности
    login/ forgot-password/ reset-password/   авторизация (Server Actions)
    auth/confirm/ auth/signout/               обмен токена из письма, выход
    dashboard/                кабинет компании: 10 разделов
    admin/                    платформенная админка
  components/
    landing/ auth/ app/ ui/ charts/
  lib/
    auth.ts                   requireSession / requireCompanySession / requireSuperAdmin
    queries.ts                данные кабинета (под RLS)
    admin-queries.ts          данные админки
    metrics.ts                CPL, CAC, ROAS, ROI, конверсия — в одном месте
    format.ts                 деньги, числа, даты (валюта — тенге)
    period.ts                 диапазон дат
    supabase/                 клиенты browser / server / admin + типы
  proxy.ts                    обновление сессии и защита закрытых маршрутов
```

Три уровня контроля доступа, каждый следующий не полагается на предыдущий:

1. `proxy.ts` — есть ли сессия;
2. `lib/auth.ts` в layout-ах — роль и статус компании;
3. RLS в PostgreSQL — что физически вернёт база.

---

## Графики

Цвета серий (`--color-series-revenue`, `--color-series-spend`) подобраны под тёмную
поверхность и проверены на различимость при дальтонизме и контраст к фону. Они намеренно
отделены от лаймового акцента интерфейса: акцент — для кнопок, серии — для данных.

Выручка и расход лежат на одной шкале в тенге; второй оси Y нет — при разных шкалах она
создаёт корреляцию, которой в данных не существует.

---

## Деплой на Vercel

1. Импортировать репозиторий, framework определится автоматически.
2. Добавить четыре переменные окружения из таблицы выше (`NEXT_PUBLIC_SITE_URL` —
   боевой адрес, например `https://lidera.kz`).
3. В Supabase → Authentication → URL Configuration добавить боевой домен и
   `https://<домен>/auth/confirm` в Redirect URLs — иначе не заработает восстановление пароля.

Рекомендуется включить Supabase → Authentication → Password protection →
проверку паролей по базе утечек: это единственное оставшееся предупреждение линтера
безопасности, и оно снимается только в интерфейсе Supabase.

---

## Что дальше

Схема уже рассчитана на следующие этапы и не потребует переписывания:

* **Meta Ads / TikTok Ads** — иерархия `ad_accounts → campaigns → ad_sets → ads → creatives`
  повторяет модель обоих API; внешние идентификаторы хранятся в `external_id`,
  синхронизация пишет в `ad_metrics`.
* **Telegram-бот и OCR** — таблица `receipts` со статусами проверки, полем `source`
  и `ocr_raw` для сырого ответа распознавания.
* **Сотрудники** — роли `MANAGER` и `EMPLOYEE` уже разрешены схемой и учтены в политиках.
* **Биллинг** — таблица `subscriptions` с планом и статусом.
