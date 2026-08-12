# Lidera — техническое задание (исходный промт)

> Полный текст задания, по которому собран проект. Хранится в репозитории,
> чтобы к нему можно было вернуться и сверить объём работ.
> Статус выполнения по каждому пункту — в конце файла.

---

## 1. Главный стек

* Frontend / Web App: **Next.js**
* Hosting / Deployment: **Vercel**
* Database: **Supabase**
* Authentication: **Supabase Auth**
* Backend/API: Next.js Server Actions / Route Handlers + Supabase
* Styling: современный responsive UI
* TypeScript
* PostgreSQL через Supabase

Проект должен нормально запускаться локально и деплоиться на Vercel.

---

## 2. ВАЖНО: SUPABASE

У меня уже есть аккаунт Supabase. В нём существует старый проект, который назывался
примерно так: **Lidera**.

Этот старый проект **НЕ ИСПОЛЬЗОВАТЬ**:

* не подключаться к нему;
* не изменять его;
* не удалять его;
* не создавать таблицы в нём.

Нужно использовать отдельный новый Supabase project — **Lidera Final**. Именно он является
основной production-базой приложения. Все таблицы, Auth, Storage, RLS и остальные настройки
должны относиться только к **Lidera Final**.

Переменные окружения:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Секретные ключи никогда не помещать непосредственно в frontend-код.

---

## 3. VERCEL

Проект должен быть полностью совместим с Vercel. Подготовить:

* production build;
* environment variables;
* правильную структуру Next.js;
* server-side API;
* Supabase integration;
* authentication;
* middleware при необходимости.

Не использовать локальные файлы или локальную базу данных как основной источник данных.
Основная база — Supabase.

---

## 4. ПЕРВЫЙ ЭТАП

Основная задача этапа:

**Создать полностью готовый презентационный сайт Lidera + рабочую систему авторизации компаний.**

Пока НЕ нужно полностью реализовывать:

* Meta Ads API;
* TikTok Ads API;
* Telegram OCR;
* автоматическую обработку чеков;
* сложную сквозную аналитику;
* сотрудников;
* биллинг;
* оплату подписки.

Но архитектура должна быть подготовлена так, чтобы эти функции можно было добавить позже
без переписывания проекта с нуля.

---

## 5. Публичный сайт

Главная страница:

# Lidera

Главный смысл: **Сквозная аналитика рекламы до реальной продажи.**

Подзаголовок: **Узнайте, какой креатив приносит не просто лиды, а реальные продажи и выручку.**

Основные CTA: **Попробовать Lidera**, **Получить доступ** (или аналогичные).

---

## 6. Структура публичного сайта

Полноценный современный landing page со следующими секциями.

### Hero

Lidera. Сквозная аналитика рекламы до реальной продажи. Показать визуальный mockup dashboard.

### Проблема

Большинство рекламных кабинетов показывают: расходы, клики, CTR, лиды, CPL.

Но бизнесу нужно знать: **Сколько денег реально принес каждый креатив.**

### Решение

Lidera объединяет: **Реклама → Лид → Пробный → Продажа → Выручка**

### Возможности

Карточки:

* **Аналитика рекламы** — Meta Ads и TikTok Ads.
* **Аналитика креативов** — определяйте лучшие и худшие креативы.
* **Сквозная аналитика** — связывайте рекламу с продажами.
* **Финансовая аналитика** — расходы, CPL, CAC, ROAS, ROI, выручка.
* **Контроль продаж** — понимайте, сколько лидов реально стали клиентами.

### Пример аналитики

| Креатив  |    Расход | Лиды |   CPL | Продажи |   Выручка | ROAS |
| -------- | --------: | ---: | ----: | ------: | --------: | ---: |
| Video 01 | 100 000 ₸ |  200 | 500 ₸ |      15 | 750 000 ₸ |  7.5 |
| Video 02 | 150 000 ₸ |  400 | 375 ₸ |       3 | 150 000 ₸ |  1.0 |

Главный вывод: **Дешёвый лид ≠ хорошая реклама.**

### Как работает

1. Подключите рекламные кабинеты.
2. Получайте данные о лидах.
3. Связывайте лиды с продажами.
4. Анализируйте эффективность каждого креатива.

### Для кого

Владельцы бизнеса; таргетологи; маркетологи; онлайн-школы; e-commerce; сервисные компании;
образовательные проекты.

### CTA

**Перестаньте смотреть только на количество лидов.**
**Смотрите, какая реклама реально приносит деньги.**

Кнопка: **Начать работу с Lidera**

---

## 7. FOOTER

Lidera. © 2026 Lidera. Все права защищены.

Ссылки: Возможности · Как работает · Контакты · Политика конфиденциальности.

И главное — кнопка **«Войти»** для существующих клиентов, ведущая на отдельную
страницу **/login**.

---

## 8. LOGIN PAGE

Отдельная страница **/login**, дизайн в стиле основного сайта.

* Заголовок: **Вход в Lidera**
* Подзаголовок: **Войдите в свой рабочий кабинет**
* Поля: Email, Пароль
* Кнопка: **Войти**
* Дополнительно: **Забыли пароль?**

---

## 9. ЛОГИКА АВТОРИЗАЦИИ

Использовать Supabase Auth. На первом этапе директор компании входит через email и пароль.
После успешной авторизации определить пользователя и его компанию.

После входа: **/login → /dashboard**

---

## 10. РОЛИ

* **SUPER_ADMIN** — владелец платформы Lidera.
* **DIRECTOR** — директор/владелец подключённой компании.

Сотрудников пока НЕ создавать, но архитектура должна позволять добавить их позже.

---

## 11. SUPER ADMIN

Отдельная административная часть **/admin**, доступная только SUPER_ADMIN.

Возможности: список компаний; создать компанию; редактировать компанию; деактивировать
компанию; посмотреть компанию; создать директора; назначить директора компании; увидеть
статус компании.

---

## 12. СОЗДАНИЕ КОМПАНИИ

В админ-панели — кнопка **+ Добавить компанию**.

Форма: Название компании · Имя директора · Email директора · Телефон · Логин/email ·
Временный пароль · Статус.

После создания:

1. создаётся компания в database;
2. создаётся пользователь Supabase Auth;
3. пользователь получает роль DIRECTOR;
4. пользователь привязывается к company_id.

---

## 13. КАБИНЕТ КОМПАНИИ

После входа директор попадает на **/dashboard**. Пока используются демонстрационные данные,
если рекламные API ещё не подключены. Dashboard должен выглядеть как настоящий SaaS.

Главные KPI: Расход 100 000 ₸ · Лиды 200 · CPL 500 ₸ · Пробные 50 · Продажи 15 ·
Выручка 750 000 ₸ · ROAS 7.5.

---

## 14. SIDEBAR

Dashboard · Реклама · Креативы · Лиды · Пробные · Продажи · Финансы · Чеки · Интеграции ·
Настройки.

Некоторые страницы могут иметь статус **«Скоро»**, но интерфейс и структура должны существовать.

---

## 15. DATABASE

Структура PostgreSQL в Supabase. Основные таблицы:

**companies** — id, name, director_name, phone, status, created_at, updated_at

**profiles** — id, user_id, company_id, role, name, created_at, updated_at

**subscriptions** — id, company_id, plan, status, start_date, end_date, created_at

**ad_accounts** — id, company_id, platform, account_name, account_id, status, created_at, updated_at

**campaigns** — id, company_id, ad_account_id, external_id, name, platform, created_at, updated_at

**ad_sets** — id, company_id, campaign_id, external_id, name, created_at, updated_at

**ads** — id, company_id, ad_set_id, external_id, name, creative_id, created_at, updated_at

**creatives** — id, company_id, external_id, name, preview_url, platform, created_at, updated_at

**ad_metrics** — id, company_id, creative_id, date, spend, impressions, reach, clicks, ctr,
cpc, cpm, leads, cpl, created_at

**leads** — id, company_id, name, phone, source, platform, campaign_id, ad_set_id, ad_id,
creative_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_at, updated_at

**trials** — id, company_id, lead_id, status, date, amount, created_at

**sales** — id, company_id, lead_id, product, amount, status, sale_date, created_at

**receipts** — id, company_id, lead_id, sale_id, file_url, phone, amount, receipt_date,
transaction_id, verification_status, uploaded_by, created_at

**integrations** — id, company_id, platform, status, account_id, last_sync_at, created_at, updated_at

**audit_logs** — id, company_id, user_id, action, entity_type, entity_id, created_at

---

## 16. MULTI-TENANT ARCHITECTURE

Lidera — multi-tenant SaaS. Каждая компания должна иметь собственный **company_id**;
все данные связаны с company_id. Компания A никогда не должна получить данные компании B.

Использовать Supabase Row Level Security (RLS). RLS должен быть включён для всех таблиц с
данными клиентов. Не полагаться только на frontend-фильтрацию.

---

## 17. SECURITY

Supabase Auth; RLS; role-based access; company-level isolation; server-side проверки;
валидация данных; безопасная работа с cookies/session; защита API; environment variables;
service role key только на сервере.

Никогда не передавать `SUPABASE_SERVICE_ROLE_KEY` в браузер.

---

## 18. ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ

Так как Meta Ads и TikTok Ads пока не подключены, создать seed/demo data. Например компания
**Demo Company** с кампаниями, ad sets, креативами, лидами, пробными, продажами и выручкой —
чтобы после входа dashboard выглядел заполненным. Demo data должна быть чётко отделена от
production данных.

---

## 19. ДИЗАЙН

Визуальный стиль: **Premium SaaS + Fintech + Marketing Analytics**.

Основной фон: глубокий чёрный, графит, белый, lime/green accent.

Стиль: минималистичный; дорогой; технологичный; профессиональный; много свободного
пространства; аккуратные карточки; красивые графики; современная типографика.
Не использовать шаблонный дешёвый дизайн.

---

## 20. RESPONSIVE

Landing page и dashboard: desktop, tablet, mobile. Sidebar на мобильном превращается в
mobile navigation.

---

## 21. SEO

Для landing page добавить title, description, Open Graph, favicon, правильные headings,
semantic HTML.

* Title: **Lidera — Сквозная аналитика рекламы до реальной продажи**
* Description: **Анализируйте рекламу, креативы, лиды, продажи и выручку в одной платформе.**

---

## 22. ДОПОЛНИТЕЛЬНО

Страница **/404** с красивым дизайном Lidera. Loading states. Error states. Empty states.

Например, если рекламный аккаунт не подключён: **Рекламные данные пока не подключены** и
кнопка **Подключить рекламный аккаунт**.

---

## 23. ПОДГОТОВКА К БУДУЩЕМУ

Архитектура должна быть готова к добавлению: Meta Ads (Marketing API); TikTok Ads API;
Telegram Bot (приём чеков); OCR (распознавание чеков); AI (анализ эффективности креативов);
Employees (сотрудники компании); Billing (тарифы и подписки); Notifications (уведомления).

Не реализовывать эти сложные функции сейчас, если они не нужны для MVP. Но database и backend
должны быть спроектированы так, чтобы их можно было добавить без полного переписывания.

---

## 24. ВАЖНО — НЕ ДЕЛАТЬ ФЕЙКОВУЮ АВТОРИЗАЦИЮ

Не использовать hardcoded логины и пароли, localStorage как систему авторизации, fake login,
frontend-only authentication. Авторизация должна реально работать через Supabase Auth.

---

## 25. ВАЖНО — НЕ ИСПОЛЬЗОВАТЬ СТАРЫЙ SUPABASE

**НЕ ИСПОЛЬЗОВАТЬ СТАРЫЙ SUPABASE PROJECT.** Создать/использовать только **Lidera Final**.
Все production-таблицы и authentication должны находиться там.

---

## 26. РЕЗУЛЬТАТ

* `/` — полноценный landing page Lidera
* `/login` — рабочий вход через Supabase
* `/dashboard` — рабочий dashboard компании
* `/admin` — управление компаниями
* Database — полностью настроенная Supabase PostgreSQL
* Security — RLS + roles + company isolation
* Deployment — готовность к Vercel

---

## 27. ПРИОРИТЕТ

1. Рабочий landing page
2. Supabase
3. Авторизация
4. Создание компаний
5. Multi-tenant architecture
6. Dashboard
7. Подготовка интеграций

Сначала создать качественный production foundation, который реально можно задеплоить на
Vercel и использовать с Supabase.

* Название проекта во всём интерфейсе: **LIDERA**
* Название production-проекта: **Lidera Final**
* Домен в будущем: **lidera.kz**

---

# Статус выполнения

| Пункт ТЗ | Статус | Где смотреть |
|---|---|---|
| 1. Стек Next.js + TS + Supabase | Готово | `package.json`, `src/` |
| 2. Только проект «Lidera Final» | Готово | ref `xnfqsoruxkjhekdklxot`; старый проект не тронут |
| 3. Совместимость с Vercel | Готово | production build проходит, всё серверное — в Server Components и Route Handlers |
| 5–6. Публичный сайт, все секции | Готово | `src/app/page.tsx` |
| 7. Footer + кнопка «Войти» | Готово | `src/components/landing/site-footer.tsx` |
| 8. Страница `/login` | Готово | `src/app/login/` |
| 9. Логика авторизации | Готово | `src/app/login/actions.ts`, `src/lib/auth.ts` |
| 10. Роли SUPER_ADMIN / DIRECTOR | Готово | схема `profiles.role`, задел под MANAGER/EMPLOYEE |
| 11–12. Админ-панель и создание компаний | Готово | `src/app/admin/` |
| 13. Кабинет компании | Готово | `src/app/dashboard/page.tsx` |
| 14. Sidebar на 10 разделов | Готово | `src/components/app/nav-config.tsx` |
| 15. Схема базы данных | Готово | `supabase/migrations/` |
| 16. Multi-tenant + RLS | Готово | миграции `..._rls.sql`, `..._harden_rls_helpers.sql` |
| 17. Security | Готово | service role только на сервере (`src/lib/supabase/admin.ts` с `server-only`) |
| 18. Демо-данные | Готово | `supabase/seed.sql`, компания помечена `is_demo` |
| 19–20. Дизайн и адаптивность | Готово | `src/app/globals.css` |
| 21. SEO | Готово | `src/app/layout.tsx`, `src/app/icon.svg` |
| 22. 404 / loading / error / empty | Готово | `not-found.tsx`, `error.tsx`, `loading.tsx`, `components/ui/empty-state.tsx` |
| 23. Задел под интеграции | Готово | таблицы `ad_accounts`, `campaigns`, `ads`, `receipts`, `integrations` под модель Meta/TikTok API |
| 24. Никакой фейковой авторизации | Готово | только Supabase Auth, проверено реальным входом |
| Meta Ads / TikTok Ads / OCR / биллинг | Не делалось — по ТЗ вне первого этапа | — |
