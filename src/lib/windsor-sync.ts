import 'server-only';

import { decryptSecret } from '@/lib/secrets';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * TikTok через Windsor — запасная дорога к тем же цифрам.
 *
 * Прямой доступ к TikTok даёт токен, а токен выдают только приложению, которое
 * площадка проверила: это дни ожидания. Windsor тем временем уже подключён к
 * кабинету и отдаёт то же самое одним плоским запросом.
 *
 * Данные ложатся в те же таблицы, что у Meta и у прямого TikTok, поэтому
 * дашборд, отчёты и аналитика подхватывают их без единой правки.
 *
 * Разница с прямым кабинетом одна, и о ней надо знать: Windsor видит рекламу на
 * уровне объявлений. Ролики, которые TikTok собирает внутри объявления сам, он
 * не различает и деньги между ними не делит. Поэтому прямой токен, когда он
 * появится, имеет приоритет — эта дорога нужна, пока его нет.
 *
 * Ключ Windsor лежит в `integrations.config` рядом с токеном TikTok,
 * зашифрованным. Отдельной строки под него нет: список площадок в базе
 * ограничен, а Windsor — не площадка, а способ добраться до TikTok.
 */

const API = 'https://connectors.windsor.ai/tiktok';

/** Сколько дней статистики перезабираем, если не сказано иное. */
const DEFAULT_WINDOW_DAYS = 30;

/** Кампании найма в отчёты не берём: соискатель — не клиент. */
const HIRING_NAME = /вакан|vakan|vacan|hiring|recruit|\bvac\b/i;

/**
 * Поля запроса. Windsor отдаёт плоскую таблицу: строка — это «объявление в
 * такой-то день», а названия кампании и ссылки на ролик повторяются в каждой.
 */
const FIELDS = [
  'date',
  'account_id',
  'account_name',
  'currency',
  'campaign_id',
  'campaign',
  'campaign_status',
  'ad_id',
  'ad_name',
  'ad_status',
  'ad_text',
  'video_id',
  'video_url',
  'video_thumbnail_url',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'conversions',
].join(',');

type Row = {
  date?: string;
  account_id?: string | null;
  account_name?: string | null;
  currency?: string | null;
  campaign_id?: string | null;
  campaign?: string | null;
  campaign_status?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  ad_status?: string | null;
  ad_text?: string | null;
  video_id?: string | null;
  video_url?: string | null;
  video_thumbnail_url?: string | null;
  spend?: number | null;
  impressions?: number | null;
  reach?: number | null;
  clicks?: number | null;
  conversions?: number | null;
};

export type WindsorSyncResult = {
  synced: { company: string; campaigns: number; creatives: number; days: number }[];
  errors: { company: string; message: string }[];
};

type Connection = { companyId: string; companyName: string; key: string };

/** Есть ли хоть у одной компании ключ Windsor. */
export async function isWindsorConfigured(): Promise<boolean> {
  return (await connections()).length > 0;
}

/**
 * Компании с ключом Windsor. Те, у кого есть прямой токен TikTok, пропускаются:
 * прямой кабинет даёт разбивку по роликам, Windsor — только по объявлениям, и
 * ходить обоими значило бы перетирать подробное общим.
 */
async function connections(): Promise<Connection[]> {
  const supabase = createAdminSupabase();

  const { data } = await supabase
    .from('integrations')
    .select('company_id, config, companies(name)')
    .eq('platform', 'tiktok');

  const rows: Connection[] = [];

  for (const row of data ?? []) {
    const config = (row.config ?? null) as {
      token_encrypted?: string;
      windsor_key_encrypted?: string;
    } | null;

    if (!config?.windsor_key_encrypted || config.token_encrypted) continue;

    const company = row.companies as unknown as { name?: string } | null;

    try {
      rows.push({
        companyId: row.company_id,
        companyName: company?.name ?? row.company_id,
        key: decryptSecret(config.windsor_key_encrypted),
      });
    } catch {
      // Ключ не расшифровался — чаще всего потому, что его зашифровали другим
      // ключом окружения. Молча пропустить нельзя: кабинет будет молчать неделями,
      // а причина не видна ниоткуда. Падать тоже не за что — остальные компании
      // синхронизируются как обычно.
      console.error(
        `windsor-sync: ключ компании ${row.company_id} не расшифровался — проверьте LIDERA_SECRETS_KEY`,
      );
      continue;
    }
  }

  return rows;
}

export async function syncAllWindsorAccounts(
  options: { windowDays?: number } = {},
): Promise<WindsorSyncResult> {
  const result: WindsorSyncResult = { synced: [], errors: [] };

  for (const connection of await connections()) {
    try {
      const counts = await syncCompany(connection, options.windowDays ?? DEFAULT_WINDOW_DAYS);
      result.synced.push({ company: connection.companyName, ...counts });
    } catch (error) {
      result.errors.push({
        company: connection.companyName,
        message: error instanceof Error ? error.message : 'неизвестная ошибка',
      });
    }
  }

  return result;
}

/**
 * Запрос к Windsor.
 *
 * Свободный тариф отвечает кодом 200 и строками, в которых вместо названий
 * стоит текст про лимит аккаунтов. Молча записать такое в базу нельзя —
 * распознаём по признаку и считаем ошибкой.
 */
async function fetchRows(key: string, since: string, until: string): Promise<Row[]> {
  const url = `${API}?api_key=${encodeURIComponent(key)}&date_from=${since}&date_to=${until}&fields=${FIELDS}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Windsor ответил ${response.status}`);
  }

  const body = (await response.json()) as { data?: Row[] } | Row[];
  const rows = Array.isArray(body) ? body : (body.data ?? []);

  const blocked = rows.find((row) => /not your real numbers|Free plan/i.test(row.campaign ?? ''));
  if (blocked) throw new Error('Windsor приостановил выдачу: проверьте тариф и число кабинетов');

  return rows.filter((row) => row.date && row.campaign_id);
}

/** Статус площадки словами платформы: у TikTok он приходит длинной строкой. */
function statusOf(value?: string | null): 'active' | 'paused' {
  return value && /DISABLE|DELETE|SUSPEND|FROZEN/i.test(value) ? 'paused' : 'active';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

async function syncCompany(
  connection: Connection,
  windowDays: number,
): Promise<{ campaigns: number; creatives: number; days: number }> {
  const supabase = createAdminSupabase();

  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));

  const since = start.toISOString().slice(0, 10);
  const until = today.toISOString().slice(0, 10);

  const rows = await fetchRows(connection.key, since, until);
  if (rows.length === 0) return { campaigns: 0, creatives: 0, days: 0 };

  // --- 1. Кабинет ---------------------------------------------------------
  const first = rows[0];
  const accountId = await upsertAccount(supabase, connection.companyId, first);

  // --- 2. Кампании --------------------------------------------------------
  const campaigns = new Map<string, Row>();
  for (const row of rows) if (row.campaign_id) campaigns.set(row.campaign_id, row);

  const { data: knownRows } = await supabase
    .from('campaigns')
    .select('external_id')
    .eq('company_id', connection.companyId)
    .eq('platform', 'tiktok');

  const known = new Set((knownRows ?? []).map((row) => row.external_id));

  const { data: savedCampaigns, error: campaignError } = await supabase
    .from('campaigns')
    .upsert(
      Array.from(campaigns.values()).map((row) => ({
        company_id: connection.companyId,
        ad_account_id: accountId,
        external_id: row.campaign_id as string,
        name: row.campaign ?? 'Без названия',
        platform: 'tiktok' as const,
        status: statusOf(row.campaign_status),
      })),
      { onConflict: 'company_id,platform,external_id' },
    )
    .select('id, external_id');

  // Без кампаний строкам статистики некуда лечь, а окно ниже стёрлось бы
  // вчистую. Такую синхронизацию обрываем.
  if (campaignError) throw new Error(`не удалось сохранить кампании: ${campaignError.message}`);

  const campaignIdByExternal = new Map<string, string>();
  for (const row of savedCampaigns ?? []) {
    if (row.external_id) campaignIdByExternal.set(row.external_id, row.id);
  }

  // Пометку найма ставим только новым кампаниям: у известных её мог снять
  // человек, и возвращать её каждой синхронизацией — спорить с ним.
  const hiring = Array.from(campaigns.values())
    .filter((row) => !known.has(row.campaign_id as string))
    .filter((row) => HIRING_NAME.test(row.campaign ?? ''))
    .map((row) => campaignIdByExternal.get(row.campaign_id as string))
    .filter(Boolean) as string[];

  if (hiring.length > 0) {
    await supabase.from('campaigns').update({ counted: false }).in('id', hiring);
  }

  // --- 3. Объявления и ролики ---------------------------------------------
  const ads = new Map<string, Row>();
  for (const row of rows) if (row.ad_id) ads.set(row.ad_id, row);

  const creativeIdByAd = new Map<string, string>();

  if (ads.size > 0) {
    const { data: savedCreatives } = await supabase
      .from('creatives')
      .upsert(
        Array.from(ads.values()).map((row) => ({
          company_id: connection.companyId,
          external_id: row.ad_id as string,
          name: row.ad_name ?? 'Без названия',
          platform: 'tiktok' as const,
          status: statusOf(row.ad_status),
          format: row.video_id ? ('video' as const) : ('image' as const),
          video_id: row.video_id ?? null,
          body: row.ad_text || null,
          // Ссылки TikTok подписаны и живут считаные часы. Поэтому и обновляем
          // их каждой синхронизацией, а не записываем раз и навсегда.
          thumbnail_url: row.video_thumbnail_url ?? null,
          preview_url: row.video_url ?? null,
        })) as never,
        { onConflict: 'company_id,platform,external_id' },
      )
      .select('id, external_id');

    for (const row of savedCreatives ?? []) {
      if (row.external_id) creativeIdByAd.set(row.external_id, row.id);
    }

    await supabase.from('ads').upsert(
      Array.from(ads.values()).map((row) => ({
        company_id: connection.companyId,
        external_id: row.ad_id as string,
        name: row.ad_name ?? 'Без названия',
        status: statusOf(row.ad_status),
        creative_id: creativeIdByAd.get(row.ad_id as string) ?? null,
        campaign_id: row.campaign_id
          ? (campaignIdByExternal.get(row.campaign_id) ?? null)
          : null,
      })) as never,
      { onConflict: 'company_id,external_id' },
    );
  }

  // --- 4. Дневная статистика ----------------------------------------------
  const currency = first.currency ?? null;

  const metrics = rows.map((row) => {
    const spend = Number(row.spend ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const clicks = Number(row.clicks ?? 0);
    const leads = Number(row.conversions ?? 0);

    return {
      company_id: connection.companyId,
      platform: 'tiktok' as const,
      campaign_id: row.campaign_id
        ? (campaignIdByExternal.get(row.campaign_id) ?? null)
        : null,
      creative_id: row.ad_id ? (creativeIdByAd.get(row.ad_id) ?? null) : null,
      date: row.date as string,
      spend,
      impressions,
      reach: Number(row.reach ?? 0),
      clicks,
      leads,
      currency,
      ctr: impressions ? round4((clicks / impressions) * 100) : 0,
      cpc: clicks ? round2(spend / clicks) : 0,
      cpm: impressions ? round2((spend / impressions) * 1000) : 0,
      cpl: leads ? round2(spend / leads) : 0,
    };
  });

  // Окно перезаписываем целиком — так повторный запуск не удваивает дни. Но
  // стирать его, когда писать нечего, нельзя: сбойный ответ унёс бы месяц
  // статистики.
  await supabase
    .from('ad_metrics')
    .delete()
    .eq('company_id', connection.companyId)
    .eq('platform', 'tiktok')
    .gte('date', since)
    .lte('date', until);

  const { error } = await supabase.from('ad_metrics').insert(metrics as never);
  if (error) throw new Error(`не удалось сохранить метрики: ${error.message}`);

  await supabase
    .from('integrations')
    .update({ status: 'connected', last_sync_at: new Date().toISOString() })
    .eq('company_id', connection.companyId)
    .eq('platform', 'tiktok');

  return {
    campaigns: campaigns.size,
    creatives: ads.size,
    days: new Set(rows.map((row) => row.date)).size,
  };
}

/**
 * Кабинет компании. Номер и валюту берём из ответа Windsor: заводя кабинет
 * руками, их обычно не знают, а расход без валюты читается как тенге и врёт.
 */
async function upsertAccount(
  supabase: ReturnType<typeof createAdminSupabase>,
  companyId: string,
  row: Row,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('platform', 'tiktok')
    .maybeSingle();

  const patch = {
    account_id: row.account_id ?? null,
    account_name: row.account_name ?? 'TikTok Ads',
    currency: row.currency ?? 'KZT',
    status: 'connected' as const,
  };

  if (existing) {
    await supabase.from('ad_accounts').update(patch).eq('id', existing.id);
    return existing.id;
  }

  const { data: created } = await supabase
    .from('ad_accounts')
    .insert({ company_id: companyId, platform: 'tiktok' as const, ...patch } as never)
    .select('id')
    .single();

  return created?.id ?? null;
}
