/** Человекочитаемые подписи статусов. Одно место для всего интерфейса. */

import {
  TRIAL_STATUS as TRIAL_STATUS_META,
  TRIAL_STATUS_ORDER,
} from '@/lib/trial-status';

// Статусы лида живут отдельно — у них есть стадии и правила воронки:
// см. lib/lead-status.ts.

// Статусы онлайн-урока тоже живут отдельно: у них есть признаки «урок
// состоялся» и «итог подведён». Здесь — только подписи для интерфейса,
// собранные из того же справочника, чтобы наборы не разъезжались.
export const TRIAL_STATUS: Record<string, { label: string; tone: Tone }> =
  Object.fromEntries(
    TRIAL_STATUS_ORDER.map((status) => [
      status,
      { label: TRIAL_STATUS_META[status].label, tone: TRIAL_STATUS_META[status].tone },
    ]),
  );

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
  inbox: 'Переписки',
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
