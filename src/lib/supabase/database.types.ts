/**
 * Типы базы данных Lidera Final.
 * Пересоздать после изменения схемы:
 *   npx supabase gen types typescript --project-id xnfqsoruxkjhekdklxot > src/lib/supabase/database.types.ts
 */

import type { AttendanceStatus, ShiftMode } from '@/lib/attendance';
import type { EmployeeRole } from '@/lib/employee-role';
import type { LeadStatus as LeadStatusValue } from '@/lib/lead-status';
import type { TrialStatus as TrialStatusValue } from '@/lib/trial-status';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'SUPER_ADMIN' | 'DIRECTOR' | 'MANAGER' | 'EMPLOYEE';
export type CompanyStatus = 'active' | 'inactive' | 'trial';
/** trial — воронка с пробным занятием, direct — прямая продажа. */
export type FunnelType = 'trial' | 'direct';
export type AdPlatform = 'meta' | 'tiktok' | 'google' | 'other';
/** Набор статусов лида ведётся в lib/lead-status.ts — там же их смысл и стадии. */
export type LeadStatus = LeadStatusValue;
/** Набор статусов урока ведётся в lib/trial-status.ts. */
export type TrialStatus = TrialStatusValue;
export type SaleStatus = 'pending' | 'paid' | 'refunded' | 'canceled';
export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'pending';

type Timestamps = { created_at: string; updated_at: string };

export type CompanyRow = Timestamps & {
  id: string;
  name: string;
  director_name: string | null;
  phone: string | null;
  email: string | null;
  status: CompanyStatus;
  funnel_type: FunnelType;
  is_demo: boolean;
  /** Валюта рекламных отчётов: расход, цена лида, CPC. */
  currency: string;
  /** Валюта денег компании: продажи, чеки, выручка, прибыль. */
  sales_currency: string;
  /** Ключ адреса приёма заявок с сайта: /api/forms/<key>. */
  lead_webhook_key: string | null;
  /** Настройки авто-раздачи лидов. */
  auto_assign: boolean;
  /** Режим смены и геолокация офиса. */
  shift_mode: ShiftMode;
  office_lat: number | null;
  office_lng: number | null;
  office_radius_m: number;
  office_label: string | null;
  timezone: string;
  work_start_time: string;
  work_end_time: string;
  /** Рабочие дни по ISO: 1 — понедельник, 7 — воскресенье. */
  work_days: number[];
  late_grace_minutes: number;
  attendance_statuses: string[];
}

/** Отметка в табеле: один день — одна строка на сотрудника. */
export type AttendanceRow = Timestamps & {
  id: string;
  company_id: string;
  employee_id: string;
  date: string;
  status: AttendanceStatus;
  note: string | null;
  source: 'auto' | 'manual';
}

/** Журнал: кому и почему достался лид. */
export type LeadAssignmentRow = {
  id: string;
  company_id: string;
  lead_id: string;
  employee_id: string;
  assigned_at: string;
  released_at: string | null;
  reason: 'auto' | 'manual' | 'sla' | 'fired' | 'shift_end';
  created_at: string;
}

/**
 * Касание лида: обещание перезвонить, напоминание бота или отметка о попытке.
 * Лид у менеджера не отбирают — вместо этого его подталкивают касаниями.
 */
export type LeadTouchRow = {
  id: string;
  company_id: string;
  lead_id: string;
  employee_id: string | null;
  kind: 'promise' | 'nudge' | 'note';
  /** Когда напомнить. */
  remind_at: string | null;
  /** Когда бот отправил напоминание. */
  notified_at: string | null;
  /** Когда касание закрыли — менеджер сдвинул статус или перенёс срок. */
  done_at: string | null;
  note: string | null;
  created_at: string;
}

export type ProfileRow = Timestamps & {
  id: string;
  user_id: string;
  company_id: string | null;
  role: UserRole;
  name: string;
  email: string | null;
  phone: string | null;
  status: 'active' | 'disabled';
}

export type SubscriptionRow = Timestamps & {
  id: string;
  company_id: string;
  plan: 'trial' | 'start' | 'pro' | 'enterprise';
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  start_date: string;
  end_date: string | null;
}

export type AdAccountRow = Timestamps & {
  id: string;
  company_id: string;
  platform: AdPlatform;
  account_name: string;
  account_id: string | null;
  status: 'connected' | 'disconnected' | 'error';
  /** Валюта рекламного кабинета: в ней приходит расход. */
  currency: string | null;
  /** Пояс кабинета: в его сутках Meta отдаёт дневную статистику. */
  timezone: string | null;
}

export type CampaignRow = Timestamps & {
  id: string;
  company_id: string;
  ad_account_id: string | null;
  external_id: string | null;
  name: string;
  platform: AdPlatform;
  status: 'active' | 'paused' | 'archived';
  objective: string | null;
  /** Номер WhatsApp, на который ведёт кампания в переписки. */
  whatsapp_number: string | null;
  /** Учитывать в отчётах: кампании найма выключают, чтобы не портить цену лида. */
  counted: boolean;
}

export type AdSetRow = Timestamps & {
  id: string;
  company_id: string;
  campaign_id: string | null;
  external_id: string | null;
  name: string;
  status: 'active' | 'paused' | 'archived';
}

export type CreativeRow = Timestamps & {
  id: string;
  company_id: string;
  external_id: string | null;
  name: string;
  preview_url: string | null;
  thumbnail_url: string | null;
  format: 'video' | 'image' | 'carousel' | 'other' | null;
  platform: AdPlatform;
  status: 'active' | 'paused' | 'archived';
  /** Медиа и тексты объявления — для просмотра креатива в кабинете. */
  video_id: string | null;
  title: string | null;
  body: string | null;
  /** Короткое имя для отчётов; пусто — подписываем «Видео N». */
  label: string | null;
}

export type AdRow = Timestamps & {
  id: string;
  company_id: string;
  ad_set_id: string | null;
  campaign_id: string | null;
  creative_id: string | null;
  external_id: string | null;
  name: string;
  status: 'active' | 'paused' | 'archived';
}

export type AdMetricRow = {
  id: string;
  company_id: string;
  creative_id: string | null;
  ad_id: string | null;
  campaign_id: string | null;
  platform: AdPlatform;
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  /** Заявки с формы — то же, что «Лиды» в Ads Manager. */
  leads: number;
  /** Начатые переписки в WhatsApp: до CRM они не доходят. */
  conversations: number;
  cpl: number;
  /** Валюта поля spend. NULL — валюта компании (демо и ручные записи). */
  currency: string | null;
  /** Как смотрели ролик: начатые просмотры, досмотры и среднее время. */
  video_plays: number;
  video_completions: number;
  video_avg_seconds: number;
  created_at: string;
}

/** Курс Нацбанка РК: сколько тенге стоит единица валюты в этот день. */
export type ExchangeRateRow = {
  date: string;
  code: string;
  kzt_per_unit: number;
  source: string;
  fetched_at: string;
}

/** Настройки Conversions API компании: токен лежит зашифрованным. */
export type CapiSettingsRow = {
  company_id: string;
  dataset_id: string;
  token_encrypted: string;
  test_event_code: string | null;
  enabled: boolean;
  last_event_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Событие, отправленное в Meta. */
export type CapiEventRow = {
  id: string;
  company_id: string;
  sale_id: string | null;
  event_name: string;
  event_id: string;
  value: number | null;
  currency: string | null;
  status: 'sent' | 'failed';
  response: string | null;
  created_at: string;
}

export type LeadRow = Timestamps & {
  id: string;
  company_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  platform: AdPlatform | null;
  campaign_id: string | null;
  ad_set_id: string | null;
  ad_id: string | null;
  creative_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  /** Метки клика по рекламе — нужны событиям CAPI. */
  fbc: string | null;
  fbp: string | null;
  /** Номер отправки формы: защита от повторной заявки. */
  external_id: string | null;
  status: LeadStatus;
  /** Оценка продажника: hot — целевой, cold — случайный. */
  quality: 'hot' | 'cold' | null;
  assigned_to: string | null;
  assigned_at: string | null;
  /** Ближайшее обещание перезвонить и счётчик попыток — для напоминаний. */
  next_touch_at: string | null;
  last_touch_at: string | null;
  touch_count: number;
}

/** Сотрудник компании. Входа в кабинет у него нет — только Telegram-бот. */
export type EmployeeRow = Timestamps & {
  id: string;
  company_id: string;
  /** Учётная запись сотрудника. Пусто — работает только через бота. */
  profile_id: string | null;
  /** Урок, по которому бот ждёт от продажника сумму продажи. */
  awaiting_amount_for: string | null;
  full_name: string;
  role: EmployeeRole;
  phone: string | null;
  telegram_user_id: number | null;
  telegram_username: string | null;
  status: 'active' | 'fired';
  hired_at: string;
  fired_at: string | null;
  /** Личные правила смены и графика. NULL — берём из компании. */
  shift_mode: ShiftMode | null;
  work_start_time: string | null;
  work_end_time: string | null;
  work_days: number[] | null;
  late_grace_minutes: number | null;
}

export type TrialRow = Timestamps & {
  id: string;
  company_id: string;
  lead_id: string | null;
  status: TrialStatus;
  date: string;
  amount: number;
  /** Продажник, который проводит урок. Назначает менеджер при записи. */
  assigned_to: string | null;
  assigned_at: string | null;
  /** Точное начало урока: онлайн важен час, а не только день. */
  starts_at: string | null;
  reminded_at: string | null;
  /** Сколько напоминаний уже ушло: за 60, 30 и 10 минут. */
  reminders_sent: number;
}

export type SaleRow = Timestamps & {
  id: string;
  company_id: string;
  lead_id: string | null;
  product: string | null;
  amount: number;
  status: SaleStatus;
  sale_date: string;
}

/**
 * Возврат денег за продажу. Одна продажа — один возврат: частичных пока нет.
 * Строку не удаляем даже при ошибке оформления — это история для разбора.
 */
export type ReturnRow = {
  id: string;
  company_id: string;
  sale_id: string;
  amount: number;
  currency: string | null;
  reason: string | null;
  /** Кто оформил: РОП или директор. */
  processed_by: string | null;
  created_at: string;
};

export type ReceiptRow = Timestamps & {
  id: string;
  company_id: string;
  lead_id: string | null;
  sale_id: string | null;
  file_url: string | null;
  phone: string | null;
  amount: number;
  receipt_date: string | null;
  transaction_id: string | null;
  verification_status: 'pending' | 'verified' | 'rejected';
  uploaded_by: string | null;
  source: 'manual' | 'telegram' | 'api';
  ocr_raw: Json | null;
}

export type IntegrationRow = Timestamps & {
  id: string;
  company_id: string;
  platform: 'meta' | 'tiktok' | 'telegram' | 'whatsapp' | 'crm' | 'other';
  status: IntegrationStatus;
  account_id: string | null;
  config: Json;
  last_sync_at: string | null;
}

/**
 * Входящая заявка с сайта — как она пришла.
 *
 * Пишется на каждый вызов вебхука, включая отклонённые: без этого потерянную
 * заявку невозможно ни увидеть, ни объяснить.
 */
export type FormSubmissionRow = {
  id: string;
  company_id: string | null;
  lead_id: string | null;
  status: 'saved' | 'duplicate' | 'rejected' | 'error';
  reason: string | null;
  payload: Json;
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  company_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Json;
  created_at: string;
}

/** Одноразовое приглашение сотрудника в Telegram-бот. */
export type EmployeeInviteRow = {
  id: string;
  company_id: string;
  employee_id: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

/** Рабочая смена: открыта, пока ended_at пуст. */
export type ShiftRow = Timestamps & {
  id: string;
  company_id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
  source: 'telegram' | 'manual';
  start_lat: number | null;
  start_lng: number | null;
  start_distance_m: number | null;
  late: boolean;
}

type TableDef<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      companies: TableDef<CompanyRow, 'name'>;
      profiles: TableDef<ProfileRow, 'user_id'>;
      subscriptions: TableDef<SubscriptionRow, 'company_id'>;
      ad_accounts: TableDef<AdAccountRow, 'company_id' | 'platform' | 'account_name'>;
      campaigns: TableDef<CampaignRow, 'company_id' | 'name' | 'platform'>;
      ad_sets: TableDef<AdSetRow, 'company_id' | 'name'>;
      ads: TableDef<AdRow, 'company_id' | 'name'>;
      creatives: TableDef<CreativeRow, 'company_id' | 'name' | 'platform'>;
      ad_metrics: TableDef<AdMetricRow, 'company_id' | 'date'>;
      exchange_rates: TableDef<ExchangeRateRow, 'date' | 'code' | 'kzt_per_unit'>;
      capi_settings: TableDef<CapiSettingsRow, 'company_id' | 'dataset_id' | 'token_encrypted'>;
      capi_events: TableDef<CapiEventRow, 'company_id' | 'event_name' | 'event_id' | 'status'>;
      leads: TableDef<LeadRow, 'company_id'>;
      employees: TableDef<EmployeeRow, 'company_id' | 'full_name' | 'role'>;
      employee_invites: TableDef<
        EmployeeInviteRow,
        'company_id' | 'employee_id' | 'token' | 'expires_at'
      >;
      shifts: TableDef<ShiftRow, 'company_id' | 'employee_id'>;
      attendance: TableDef<
        AttendanceRow,
        'company_id' | 'employee_id' | 'date' | 'status'
      >;
      lead_assignments: TableDef<
        LeadAssignmentRow,
        'company_id' | 'lead_id' | 'employee_id'
      >;
      lead_touches: TableDef<LeadTouchRow, 'company_id' | 'lead_id'>;
      trials: TableDef<TrialRow, 'company_id'>;
      sales: TableDef<SaleRow, 'company_id'>;
      returns: TableDef<ReturnRow, 'company_id' | 'sale_id'>;
      receipts: TableDef<ReceiptRow, 'company_id'>;
      integrations: TableDef<IntegrationRow, 'company_id' | 'platform'>;
      form_submissions: TableDef<FormSubmissionRow, 'status'>;
      audit_logs: TableDef<AuditLogRow, 'action'>;
    };
    Views: Record<never, never>;
    // Служебные функции RLS живут в схеме private и наружу не выставлены.
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
