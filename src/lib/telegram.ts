import 'server-only';

/**
 * Тонкий клиент Telegram Bot API.
 *
 * Токен читается только здесь и только на сервере — в браузер он не уходит
 * (файл помечен 'server-only', сборка упадёт при импорте из клиента).
 */

const API = 'https://api.telegram.org';

export function isBotConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN.');
  return token;
}

/** Секрет вебхука: Telegram присылает его заголовком в каждом запросе. */
export function webhookSecret(): string | undefined {
  return process.env.TELEGRAM_WEBHOOK_SECRET || undefined;
}

export type InlineButton = { text: string; callback_data: string };

async function call(method: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${API}/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  // Ошибку Telegram не бросаем наружу: вебхук обязан ответить 200, иначе
  // Telegram будет слать то же обновление снова и снова.
  if (!response.ok) {
    console.error('telegram', method, response.status, await response.text());
  }
}

/** Кнопка обычной клавиатуры. Строка — просто текст, объект — запрос данных. */
export type KeyboardButton = string | { text: string; request_location: true };

export function sendMessage(
  chatId: number,
  text: string,
  options?: { inline?: InlineButton[][]; keyboard?: KeyboardButton[][] },
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };

  if (options?.inline) {
    payload.reply_markup = { inline_keyboard: options.inline };
  } else if (options?.keyboard) {
    payload.reply_markup = {
      keyboard: options.keyboard.map((row) =>
        row.map((button) => (typeof button === 'string' ? { text: button } : button)),
      ),
      resize_keyboard: true,
    };
  }

  return call('sendMessage', payload);
}

export function answerCallback(callbackId: string, text?: string): Promise<void> {
  return call('answerCallbackQuery', { callback_query_id: callbackId, text });
}

export function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  inline?: InlineButton[][],
): Promise<void> {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: inline ? { inline_keyboard: inline } : undefined,
  });
}

/** Привязать вебхук к адресу. Вызывается скриптом при деплое. */
export async function setWebhook(url: string): Promise<string> {
  const response = await fetch(`${API}/bot${botToken()}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: webhookSecret(),
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    }),
  });
  return response.text();
}
