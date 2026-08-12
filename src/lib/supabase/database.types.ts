/**
 * Типы базы данных Lidera Final.
 * Пересоздать после изменения схемы:
 *   npx supabase gen types typescript --project-id xnfqsoruxkjhekdklxot > src/lib/supabase/database.types.ts
 */

import type { LeadStatus as LeadStatusValue } from '@/lib/lead-status';

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
export type TrialStatus = 'scheduled' | 'completed' | 'no_show' | 'canceled';
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
}

export type AdRow = Timestamps & {
  id: string;
  company_id: string;
  ad_set_id: string | null;
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
  leads: number;
  cpl: number;
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
  status: LeadStatus;
}

export type TrialRow = Timestamps & {
  id: string;
  company_id: string;
  lead_id: string | null;
  status: TrialStatus;
  date: string;
  amount: number;
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
      leads: TableDef<LeadRow, 'company_id'>;
      trials: TableDef<TrialRow, 'company_id'>;
      sales: TableDef<SaleRow, 'company_id'>;
      receipts: TableDef<ReceiptRow, 'company_id'>;
      integrations: TableDef<IntegrationRow, 'company_id' | 'platform'>;
      audit_logs: TableDef<AuditLogRow, 'action'>;
    };
    Views: Record<never, never>;
    // Служебные функции RLS живут в схеме private и наружу не выставлены.
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
