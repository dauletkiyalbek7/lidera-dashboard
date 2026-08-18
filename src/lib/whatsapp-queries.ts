import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Данные раздела «WhatsApp».
 *
 * Секреты отсюда не возвращаются никогда — только признак «задан или нет».
 * Токен, попавший в свойства страницы, уезжает в браузер вместе с разметкой,
 * и никакая защита интерфейса его там уже не догонит.
 */

export type WhatsappNumberView = {
  id: string;
  label: string;
  displayPhone: string | null;
  phoneNumberId: string;
  wabaId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  webhookKey: string;
  verifyToken: string;
  status: 'connected' | 'disconnected' | 'error';
  lastError: string | null;
  lastMessageAt: string | null;
  hasToken: boolean;
  hasAppSecret: boolean;
  autoReplyEnabled: boolean;
  autoReplyDay: string | null;
  autoReplyNight: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
};

export type WhatsappOverview = {
  numbers: WhatsappNumberView[];
  departments: { id: string; name: string }[];
  stats: {
    connected: number;
    leads: number;
    inbound: number;
    outbound: number;
    /** Переписки с меткой клика: только их покупки Meta примет обратно. */
    withClick: number;
  };
};

export async function getWhatsappOverview(companyId: string): Promise<WhatsappOverview> {
  const supabase = await createServerSupabase();

  const [{ data: numbers }, { data: departments }, inbound, outbound, leads, clicks] =
    await Promise.all([
      supabase
        .from('whatsapp_numbers')
        .select(
          'id, label, display_phone, phone_number_id, waba_id, department_id, webhook_key, verify_token, status, last_error, last_message_at, token_encrypted, app_secret_encrypted, auto_reply_enabled, auto_reply_day, auto_reply_night, work_start_time, work_end_time',
        )
        .eq('company_id', companyId)
        .order('created_at'),
      supabase
        .from('departments')
        .select('id, name')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .order('name'),
      supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('direction', 'in'),
      supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('direction', 'out'),
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .not('whatsapp_number_id', 'is', null),
      supabase
        .from('lead_clicks')
        .select('lead_id')
        .eq('company_id', companyId),
    ]);

  const departmentNames = new Map((departments ?? []).map((row) => [row.id, row.name]));

  return {
    numbers: (numbers ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      displayPhone: row.display_phone,
      phoneNumberId: row.phone_number_id,
      wabaId: row.waba_id,
      departmentId: row.department_id,
      departmentName: row.department_id
        ? (departmentNames.get(row.department_id) ?? null)
        : null,
      webhookKey: row.webhook_key,
      verifyToken: row.verify_token,
      status: row.status,
      lastError: row.last_error,
      lastMessageAt: row.last_message_at,
      hasToken: Boolean(row.token_encrypted),
      hasAppSecret: Boolean(row.app_secret_encrypted),
      autoReplyEnabled: row.auto_reply_enabled,
      autoReplyDay: row.auto_reply_day,
      autoReplyNight: row.auto_reply_night,
      workStartTime: row.work_start_time,
      workEndTime: row.work_end_time,
    })),
    departments: departments ?? [],
    stats: {
      connected: (numbers ?? []).filter((row) => row.status === 'connected').length,
      leads: leads.count ?? 0,
      inbound: inbound.count ?? 0,
      outbound: outbound.count ?? 0,
      // Один человек мог кликнуть несколько раз — считаем людей, а не клики.
      withClick: new Set((clicks.data ?? []).map((row) => row.lead_id)).size,
    },
  };
}
