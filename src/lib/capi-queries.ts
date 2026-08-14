import 'server-only';

import { creativeLabel } from '@/lib/queries';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Данные раздела «CAPI» — что именно платформа отправила в Meta.
 *
 * Раздел отвечает на один вопрос: «мы сказали Meta про эту покупку или нет».
 * Без него отправка событий — чёрный ящик: реклама учится на данных, которых
 * никто не видит, и разобраться, почему конверсии не сходятся, невозможно.
 *
 * Журнал отправок компания читает своим ключом — политика RLS это позволяет.
 * Настройки лежат в таблице без политик (там токен), поэтому только сервисным.
 */

export type CapiEventItem = {
  id: string;
  createdAt: string;
  status: 'sent' | 'failed';
  value: number;
  currency: string | null;
  response: string | null;
  /** Кому продали — из заявки, к которой привязана продажа. */
  customerName: string | null;
  phone: string | null;
  creativeName: string | null;
  creativeId: string | null;
  /** Проверочное событие: продажи за ним нет. */
  test: boolean;
};

export type CapiOverview = {
  events: CapiEventItem[];
  sent: number;
  failed: number;
  /** Оплаченные продажи за период, о которых Meta так и не узнала. */
  missing: number;
};

export async function getCapiOverview(
  companyId: string,
  from: string,
  to: string,
): Promise<CapiOverview> {
  const supabase = await createServerSupabase();

  const { data: events } = await supabase
    .from('capi_events')
    .select('id, sale_id, status, value, currency, response, created_at')
    .eq('company_id', companyId)
    .gte('created_at', `${from}T00:00:00Z`)
    .lte('created_at', `${to}T23:59:59Z`)
    .order('created_at', { ascending: false })
    .limit(200);

  const saleIds = [
    ...new Set((events ?? []).map((event) => event.sale_id).filter((id): id is string => !!id)),
  ];

  const { data: sales } = saleIds.length
    ? await supabase.from('sales').select('id, lead_id').in('id', saleIds)
    : { data: [] };

  const leadIds = [
    ...new Set((sales ?? []).map((sale) => sale.lead_id).filter((id): id is string => !!id)),
  ];

  const [{ data: leads }, { data: creatives }] = await Promise.all([
    leadIds.length
      ? supabase.from('leads').select('id, name, phone, creative_id').in('id', leadIds)
      : Promise.resolve({ data: [] as { id: string; name: string; phone: string | null; creative_id: string | null }[] }),
    supabase
      .from('creatives')
      .select('id, name, label, format, created_at')
      .eq('company_id', companyId)
      .order('created_at'),
  ]);

  const creativeNames = new Map(
    (creatives ?? []).map((row, index) => [row.id, creativeLabel(row, index + 1)]),
  );
  const leadById = new Map((leads ?? []).map((lead) => [lead.id, lead]));
  const leadBySale = new Map(
    (sales ?? []).map((sale) => [sale.id, sale.lead_id ? leadById.get(sale.lead_id) : undefined]),
  );

  const items: CapiEventItem[] = (events ?? []).map((event) => {
    const lead = event.sale_id ? leadBySale.get(event.sale_id) : undefined;
    const creativeId = lead?.creative_id ?? null;

    return {
      id: event.id,
      createdAt: event.created_at,
      status: event.status === 'failed' ? 'failed' : 'sent',
      value: Number(event.value ?? 0),
      currency: event.currency,
      response: event.response,
      customerName: lead?.name ?? null,
      phone: lead?.phone ?? null,
      creativeId,
      creativeName: creativeId ? (creativeNames.get(creativeId) ?? null) : null,
      test: event.sale_id === null,
    };
  });

  // Оплаченные продажи, по которым события так и не ушло: именно они и есть
  // потерянное обучение рекламы.
  const { data: paid } = await supabase
    .from('sales')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'paid')
    .gte('sale_date', from)
    .lte('sale_date', to);

  const reported = new Set(
    (events ?? [])
      .filter((event) => event.status === 'sent' && event.sale_id)
      .map((event) => event.sale_id as string),
  );

  return {
    events: items,
    sent: items.filter((item) => item.status === 'sent').length,
    failed: items.filter((item) => item.status === 'failed').length,
    missing: (paid ?? []).filter((sale) => !reported.has(sale.id)).length,
  };
}

export type CapiSettingsView = {
  datasetId: string;
  testEventCode: string | null;
  enabled: boolean;
  lastEventAt: string | null;
  lastError: string | null;
  /** Токен наружу не отдаём никогда — только признак, что он сохранён. */
  hasToken: boolean;
};

/** Настройки без токена. Таблица без политик RLS, поэтому сервисный ключ. */
export async function getCompanyCapiSettings(
  companyId: string,
): Promise<CapiSettingsView | null> {
  const supabase = createAdminSupabase();

  const { data } = await supabase
    .from('capi_settings')
    .select('dataset_id, test_event_code, enabled, last_event_at, last_error, token_encrypted')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!data) return null;

  return {
    datasetId: data.dataset_id,
    testEventCode: data.test_event_code,
    enabled: data.enabled,
    lastEventAt: data.last_event_at,
    lastError: data.last_error,
    hasToken: Boolean(data.token_encrypted),
  };
}
