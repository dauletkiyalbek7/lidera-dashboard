import 'server-only';

import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Синхронизация с Meta Marketing API.
 *
 * Платформа сама ходит в рекламный кабинет и складывает дневные цифры в
 * ad_metrics — тот же формат, что у демо-данных, поэтому интерфейс не знает,
 * откуда взялись числа.
 *
 * Токен только на сервере: у него право ads_read, менять кампании им нельзя.
 * Пока токен один на платформу (у владельца один бизнес-менеджер); когда
 * клиентов станет больше, он переедет в integrations.config в зашифрованном
 * виде — на форму синхронизации это не повлияет.
 */

const API_VERSION = process.env.META_API_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

/** Сколько дней перезабираем при каждом запуске. */
const WINDOW_DAYS = 30;

/** Meta досчитывает конверсии несколько дней, поэтому недавние дни перезаписываем. */
const CONVERSATION_ACTIONS = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
];

const LEAD_ACTIONS = ['lead', 'leadgen.other', 'onsite_conversion.lead_grouped'];

export type MetaSyncResult = {
  account: string;
  campaigns: number;
  days: number;
  rows: number;
  spend: number;
};

export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN);
}

/** Синхронизация всех компаний, у которых подключён кабинет Meta. */
export async function syncAllMetaAccounts(): Promise<{
  accounts: MetaSyncResult[];
  errors: { account: string; message: string }[];
}> {
  const supabase = createAdminSupabase();
  const { data: accounts } = await supabase
    .from('ad_accounts')
    .select('id, company_id, account_id, account_name')
    .eq('platform', 'meta')
    .not('account_id', 'is', null);

  const results: MetaSyncResult[] = [];
  const errors: { account: string; message: string }[] = [];

  for (const account of accounts ?? []) {
    try {
      results.push(await syncMetaAccount(account.id));
    } catch (error) {
      errors.push({
        account: account.account_name,
        message: error instanceof Error ? error.message : 'неизвестная ошибка',
      });
    }
  }

  return { accounts: results, errors };
}

/**
 * Отметка о синхронизации в «Интеграциях».
 *
 * Директор должен сам видеть, когда данные обновлялись и что пошло не так, —
 * иначе единственный способ узнать про истёкший токен это заметить, что цифры
 * замерли.
 */
async function noteSync(
  companyId: string,
  accountId: string | null,
  outcome: { ok: true; result: MetaSyncResult } | { ok: false; message: string },
) {
  const supabase = createAdminSupabase();

  await supabase.from('integrations').upsert(
    {
      company_id: companyId,
      platform: 'meta',
      account_id: accountId,
      status: outcome.ok ? 'connected' : 'error',
      last_sync_at: new Date().toISOString(),
      config: outcome.ok
        ? {
            rows: outcome.result.rows,
            days: outcome.result.days,
            campaigns: outcome.result.campaigns,
            spend: outcome.result.spend,
            error: null,
          }
        : { error: outcome.message },
    },
    { onConflict: 'company_id,platform' },
  );
}

/**
 * Одна компания. Порядок: кампании (с номером WhatsApp) → дневные метрики.
 * Окно перезаписываем целиком: Meta уточняет вчерашние цифры ещё пару дней,
 * и «дописывать» их было бы неверно.
 */
export async function syncMetaAccount(adAccountRowId: string): Promise<MetaSyncResult> {
  const supabase = createAdminSupabase();

  const { data: account } = await supabase
    .from('ad_accounts')
    .select('id, company_id, account_id, account_name')
    .eq('id', adAccountRowId)
    .maybeSingle();

  if (!account?.account_id) throw new Error('рекламный кабинет не найден');

  try {
    const result = await pullFromMeta(account);
    await noteSync(account.company_id, account.account_id, { ok: true, result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка';
    await supabase.from('ad_accounts').update({ status: 'error' }).eq('id', account.id);
    await noteSync(account.company_id, account.account_id, { ok: false, message });
    throw error;
  }
}

type AdAccount = {
  id: string;
  company_id: string;
  account_id: string | null;
  account_name: string;
};

async function pullFromMeta(account: AdAccount): Promise<MetaSyncResult> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('не задан META_ACCESS_TOKEN');

  const supabase = createAdminSupabase();

  if (!account.account_id) throw new Error('у кабинета не указан ID');

  const actId = account.account_id.startsWith('act_')
    ? account.account_id
    : `act_${account.account_id}`;

  const since = isoDate(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const until = isoDate(new Date());

  // --- 1. Номера WhatsApp: они живут в настройках групп объявлений ---------
  const numberByCampaign = new Map<string, string>();
  const adSets = await graph<{ campaign_id?: string; promoted_object?: { whatsapp_phone_number?: string } }>(
    `${GRAPH}/${actId}/adsets?fields=campaign_id,promoted_object&limit=200&access_token=${token}`,
  );
  for (const adSet of adSets) {
    const number = adSet.promoted_object?.whatsapp_phone_number;
    if (adSet.campaign_id && number) numberByCampaign.set(adSet.campaign_id, number);
  }

  // --- 2. Кампании --------------------------------------------------------
  const campaigns = await graph<{ id: string; name: string; status: string; objective?: string }>(
    `${GRAPH}/${actId}/campaigns?fields=name,status,objective&limit=200&access_token=${token}`,
  );

  const campaignIdByExternal = new Map<string, string>();

  for (const campaign of campaigns) {
    const { data: saved } = await supabase
      .from('campaigns')
      .upsert(
        {
          company_id: account.company_id,
          ad_account_id: account.id,
          external_id: campaign.id,
          name: campaign.name,
          platform: 'meta',
          status: campaignStatus(campaign.status),
          objective: campaign.objective ?? null,
          // Номер не затираем: если Meta его не отдала, остаётся прежний.
          ...(numberByCampaign.has(campaign.id)
            ? { whatsapp_number: numberByCampaign.get(campaign.id) }
            : {}),
        },
        { onConflict: 'company_id,platform,external_id' },
      )
      .select('id')
      .maybeSingle();

    if (saved) campaignIdByExternal.set(campaign.id, saved.id);
  }

  // --- 3. Дневные метрики по кампаниям ------------------------------------
  const insights = await graph<MetaInsight>(
    `${GRAPH}/${actId}/insights?level=campaign&time_increment=1` +
      `&fields=campaign_id,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,date_start` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
      `&limit=500&access_token=${token}`,
  );

  const rows = insights
    .filter((row) => row.campaign_id && campaignIdByExternal.has(row.campaign_id))
    .map((row) => {
      const spend = Number(row.spend ?? 0);
      const conversations = actionValue(row.actions, CONVERSATION_ACTIONS);
      const leads = conversations || actionValue(row.actions, LEAD_ACTIONS);

      return {
        company_id: account.company_id,
        campaign_id: campaignIdByExternal.get(row.campaign_id!)!,
        creative_id: null,
        platform: 'meta' as const,
        date: row.date_start,
        spend,
        impressions: Number(row.impressions ?? 0),
        reach: Number(row.reach ?? 0),
        clicks: Number(row.clicks ?? 0),
        ctr: Number(row.ctr ?? 0),
        cpc: Number(row.cpc ?? 0),
        cpm: Number(row.cpm ?? 0),
        leads,
        cpl: leads ? Number((spend / leads).toFixed(2)) : 0,
      };
    });

  // Окно перезаписываем: так повторный запуск не удваивает дни.
  await supabase
    .from('ad_metrics')
    .delete()
    .eq('company_id', account.company_id)
    .eq('platform', 'meta')
    .gte('date', since)
    .lte('date', until);

  if (rows.length > 0) {
    const { error } = await supabase.from('ad_metrics').insert(rows);
    if (error) throw new Error(`не удалось сохранить метрики: ${error.message}`);
  }

  await supabase
    .from('ad_accounts')
    .update({ status: 'connected' })
    .eq('id', account.id);

  return {
    account: account.account_name,
    campaigns: campaignIdByExternal.size,
    days: new Set(rows.map((row) => row.date)).size,
    rows: rows.length,
    spend: Number(rows.reduce((total, row) => total + row.spend, 0).toFixed(2)),
  };
}

type MetaInsight = {
  campaign_id?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: { action_type: string; value: string }[];
};

/** Сумма нужных действий из массива actions. Первое совпадение и есть результат. */
function actionValue(
  actions: { action_type: string; value: string }[] | undefined,
  types: string[],
): number {
  if (!actions) return 0;
  for (const type of types) {
    const found = actions.find((action) => action.action_type === type);
    if (found) return Number(found.value) || 0;
  }
  return 0;
}

function campaignStatus(status: string): 'active' | 'paused' | 'archived' {
  if (status === 'ACTIVE') return 'active';
  if (status === 'ARCHIVED' || status === 'DELETED') return 'archived';
  return 'paused';
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Запрос к Graph API со сквозной постраничкой.
 * Ошибку Meta пробрасываем текстом: «токен истёк» должно быть видно сразу,
 * а не превращаться в пустой отчёт.
 */
async function graph<T>(url: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = url;

  while (next) {
    const response: Response = await fetch(next, { cache: 'no-store' });
    const payload = (await response.json()) as {
      data?: T[];
      paging?: { next?: string };
      error?: { message: string; code: number };
    };

    if (payload.error) {
      throw new Error(`Meta API: ${payload.error.message} (код ${payload.error.code})`);
    }
    if (!response.ok) {
      throw new Error(`Meta API вернул ${response.status}`);
    }

    items.push(...(payload.data ?? []));
    next = payload.paging?.next ?? null;

    // Защита от бесконечной постранички при неожиданном ответе.
    if (items.length > 20000) break;
  }

  return items;
}
