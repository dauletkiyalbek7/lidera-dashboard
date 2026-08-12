/** Человекочитаемые подписи статусов. Одно место для всего интерфейса. */

// Статусы лида живут отдельно — у них есть стадии и правила воронки:
// см. lib/lead-status.ts.

export const TRIAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: 'Запланирован', tone: 'neutral' },
  completed: { label: 'Проведён', tone: 'positive' },
  no_show: { label: 'Не пришёл', tone: 'negative' },
  canceled: { label: 'Отменён', tone: 'neutral' },
};

export const SALE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Ожидает оплаты', tone: 'warning' },
  paid: { label: 'Оплачено', tone: 'positive' },
  refunded: { label: 'Возврат', tone: 'negative' },
  canceled: { label: 'Отменено', tone: 'neutral' },
};

export const COMPANY_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Активна', tone: 'positive' },
  trial: { label: 'Пробный период', tone: 'warning' },
  inactive: { label: 'Деактивирована', tone: 'negative' },
};

export const INTEGRATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  connected: { label: 'Подключено', tone: 'positive' },
  disconnected: { label: 'Не подключено', tone: 'neutral' },
  pending: { label: 'Ожидает подтверждения', tone: 'warning' },
  error: { label: 'Ошибка', tone: 'negative' },
};

export const PLATFORM_LABELS: Record<string, string> = {
  meta: 'Meta Ads',
  tiktok: 'TikTok Ads',
  google: 'Google Ads',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  crm: 'CRM',
  other: 'Другое',
};

export const PLAN_LABELS: Record<string, string> = {
  trial: 'Пробный',
  start: 'Start',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Администратор платформы',
  DIRECTOR: 'Директор компании',
  MANAGER: 'Менеджер',
  EMPLOYEE: 'Сотрудник',
};

type Tone = 'neutral' | 'positive' | 'warning' | 'negative' | 'lime';

export function statusOf(
  dictionary: Record<string, { label: string; tone: Tone }>,
  key: string,
): { label: string; tone: Tone } {
  return dictionary[key] ?? { label: key, tone: 'neutral' };
}
