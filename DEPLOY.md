# Деплой на Vercel

Порядок один раз, дальше каждый `git push` выкатывается сам.

## 1. Репозиторий на GitHub

Репозиторий должен быть **приватным**: в коде нет секретов (`.env.local` в
`.gitignore`), но открывать логику продукта наружу незачем.

```bash
git remote add origin git@github.com:<аккаунт>/lidera-dashboard.git
git push -u origin main
```

## 2. Импорт в Vercel

Vercel → **Add New → Project** → выбрать репозиторий → **Import**.
Framework определится автоматически (Next.js), команды сборки менять не нужно.

## 3. Переменные окружения

До первого деплоя — **Environment Variables**. В Vercel можно вставить сразу весь
файл: скопируйте содержимое `.env.local` целиком, кроме `NEXT_PUBLIC_SITE_URL` —
его значение должно быть боевым адресом, а не `localhost`.

| Переменная | Значение | Видна браузеру |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | как в `.env.local` | да |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | как в `.env.local` | да |
| `SUPABASE_SERVICE_ROLE_KEY` | как в `.env.local` | **нет** |
| `NEXT_PUBLIC_SITE_URL` | `https://<проект>.vercel.app` | да |
| `TELEGRAM_BOT_TOKEN` | как в `.env.local` | **нет** |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | `lidera_dash_bot` | да |
| `TELEGRAM_WEBHOOK_SECRET` | как в `.env.local` | **нет** |

Отмечайте все три окружения (Production, Preview, Development).

## 4. Supabase: разрешить боевой адрес

Supabase → Authentication → **URL Configuration**:

* **Site URL** — `https://<проект>.vercel.app`;
* **Redirect URLs** — добавить `https://<проект>.vercel.app/auth/confirm`.

Без этого ссылки из писем восстановления пароля будут вести на localhost.

## 5. Вебхук Telegram

После успешного деплоя привязать бота к боевому адресу:

```bash
curl -sX POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://<проект>.vercel.app/api/telegram/webhook",
       "secret_token":"'"$TELEGRAM_WEBHOOK_SECRET"'",
       "allowed_updates":["message","callback_query"],
       "drop_pending_updates":true}'
```

Проверка: `getWebhookInfo` должен показать этот адрес и `pending_update_count: 0`.

## 6. Проверить после выката

1. `/` открывается, вход `/login` работает под всеми тремя демо-аккаунтами;
2. `/dashboard` показывает цифры, диапазон дат переключается;
3. в разделе «Команда» кнопка «Пригласить» выдаёт ссылку `t.me/lidera_dash_bot?start=…`;
4. по ссылке бот отвечает и привязывает аккаунт;
5. «Я на смене» → «Мои лиды» → кнопка статуса меняет статус в кабинете.

## Смена секретов

Токен бота меняется в @BotFather командой `/revoke`, ключ Supabase — в
Project Settings → API Keys. После смены обновить значение в Vercel и
передеплоить: старое значение остаётся в собранном окружении до следующей сборки.
