import 'server-only';

import { decryptSecret } from '@/lib/secrets';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Синхронизация с TikTok Ads — той же моделью данных, что и Meta.
 *
 * Кампании, группы, объявления и дневная статистика ложатся в те же таблицы,
 * поэтому отчёты, дашборд и аналитика креативов подхватывают TikTok без единой
 * правки: они читают `ad_metrics`, не разбирая площадку.
 *
 * Отличие от Meta одно, и оно в деньгах: кабинет TikTok у наших проектов ведёт
 * тенге, а сами проекты считают в долларах. Расход кладём как есть, в валюте
 * кабинета, — пересчёт делается при чтении по курсу того дня, когда деньги
 * были потрачены.
 *
 * Токен живёт в `integrations.config`, зашифрованным. В браузер он не уходит
 * никогда: этот файл серверный, и страница знает только, задан токен или нет.
 */

const API = 'https://business-api.tiktok.com/open_api/v1.3';

/** Сколько дней статистики перезабираем, если не сказано иное. */
const DEFAULT_WINDOW_DAYS = 30;

/** Страница списка: больше тысячи TikTok за раз не отдаёт. */
const PAGE_SIZE = 1000;

/** Отчёт с разбивкой по дням ограничен месяцем — это правило самого TikTok. */
const MAX_REPORT_DAYS = 30;

/** Кампании найма в отчёты не берём: соискатель — не клиент. */
const HIRING_NAME = /вакан|vakan|vacan|hiring|recruit|\bvac\b/i;

type Account = {
  id: string;
  company_id: string;
  account_id: string;
  account_name: string;
};

type TikTokAnswer<T> = {
  code: number;
  message: string;
  data?: { list?: T[]; page_info?: { page: number; total_page: number } };
};

export type TikTokSyncResult = {
  synced: { account: string; campaigns: number; creatives: number; days: number }[];
  errors: { account: string; message: string }[];
};

/**
 * Запрос к TikTok. Ошибку возвращает не кодом ответа, а полем `code` внутри
 * тела — поэтому проверять только HTTP-статус недостаточно.
 */
async function call<T>(
  path: string,
  token: string,
  params: Record<string, string | number>,
): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;

  for (;;) {
    const query = new URLSearchParams();
    for (const [field, value] of Object.entries(params)) query.set(field, String(value));
    query.set('page', String(page));
    query.set('page_size', String(PAGE_SIZE));

    const response = await fetch(`${API}${path}?${query.toString()}`, {
      headers: { 'Access-Token': token },
      cache: 'no-store',
    });

    const answer = (await response.json()) as TikTokAnswer<T>;

    if (answer.code !== 0) {
      throw new Error(`TikTok ответил отказом: ${answer.message || answer.code}`);
    }

    rows.push(...(answer.data?.list ?? []));

    const info = answer.data?.page_info;
    if (!info || info.page >= info.total_page || info.total_page === 0) break;
    page += 1;
  }

  return rows;
}

/** Статус кампании и объявления одним словарём: TikTok называет их одинаково. */
function statusOf(operation: string | undefined, secondary: string | undefined) {
  if (secondary?.includes('DELETE')) return 'archived' as const;
  return operation === 'ENABLE' ? ('active' as const) : ('paused' as const);
}

function isoDay(shift: number): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - shift);
  return day.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function num(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Токен кабинета. Держим по компании, а не по кабинету: одно приложение
 * TikTok выдаёт доступ сразу ко всем кабинетам своего Business Center.
 */
async function tokenFor(
  supabase: ReturnType<typeof createAdminSupabase>,
  companyId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('integrations')
    .select('config')
    .eq('company_id', companyId)
    .eq('platform', 'tiktok')
    .maybeSingle();

  const config = (data?.config ?? null) as { token_encrypted?: string } | null;
  if (!config?.token_encrypted) return null;

  try {
    return decryptSecret(config.token_encrypted);
  } catch {
    // Ключ шифрования сменили — токен придётся ввести заново. Молча падать
    // нельзя: без этой записи в журнале причина выглядит как «TikTok не
    // отвечает», и чинить будут не то.
    console.error(`tiktok-sync: не удалось расшифровать токен компании ${companyId}`);
    return null;
  }
}

/** Есть ли вообще что синхронизировать — чтобы крон не ходил впустую. */
export async function isTikTokConfigured(): Promise<boolean> {
  const supabase = createAdminSupabase();
  const { count } = await supabase
    .from('ad_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'tiktok')
    .not('account_id', 'is', null);

  return (count ?? 0) > 0;
}

export async function syncAllTikTokAccounts(options?: {
  windowDays?: number;
}): Promise<TikTokSyncResult> {
  const supabase = createAdminSupabase();
  const result: TikTokSyncResult = { synced: [], errors: [] };

  const { data: accounts } = await supabase
    .from('ad_accounts')
    .select('id, company_id, account_id, account_name')
    .eq('platform', 'tiktok')
    .not('account_id', 'is', null);

  for (const account of (accounts ?? []) as Account[]) {
    try {
      const done = await syncAccount(supabase, account, options?.windowDays);
      result.synced.push({ account: account.account_name, ...done });
      await noteSync(supabase, account, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка';
      result.errors.push({ account: account.account_name, message });
      await noteSync(supabase, account, { ok: false, message });
    }
  }

  return result;
}

async function noteSync(
  supabase: ReturnType<typeof createAdminSupabase>,
  account: Account,
  outcome: { ok: boolean; message?: string },
) {
  await supabase.from('integrations').upsert(
    {
      company_id: account.company_id,
      platform: 'tiktok',
      status: outcome.ok ? 'connected' : 'error',
      last_sync_at: new Date().toISOString(),
      // Поле config здесь не трогаем намеренно: в нём лежит токен, и запись
      // ошибки рядом стёрла бы его — починка после первого же сбоя
      // превратилась бы во «введите ключи заново».
    } as never,
    { onConflict: 'company_id,platform' },
  );

  await supabase
    .from('ad_accounts')
    .update({ status: outcome.ok ? 'connected' : 'error' })
    .eq('id', account.id);
}

async function syncAccount(
  supabase: ReturnType<typeof createAdminSupabase>,
  account: Account,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<{ campaigns: number; creatives: number; days: number }> {
  const token = await tokenFor(supabase, account.company_id);
  if (!token) throw new Error('токен TikTok не задан');

  const days = Math.min(windowDays, MAX_REPORT_DAYS);
  const since = isoDay(days - 1);
  const until = isoDay(0);

  // --- 1. Кампании --------------------------------------------------------
  const campaigns = await call<{
    campaign_id: string;
    campaign_name: string;
    objective_type?: string;
    operation_status?: string;
    secondary_status?: string;
    budget?: number;
  }>('/campaign/get/', token, { advertiser_id: account.account_id });

  const campaignIdByExternal = new Map<string, string>();

  // Какие кампании платформа уже знала: пометку найма ставим только новым.
  const { data: knownRows } = await supabase
    .from('campaigns')
    .select('external_id')
    .eq('company_id', account.company_id)
    .eq('platform', 'tiktok');

  const known = new Set((knownRows ?? []).map((row) => row.external_id));

  if (campaigns.length > 0) {
    const { data: saved, error } = await supabase
      .from('campaigns')
      .upsert(
        campaigns.map((campaign) => ({
          company_id: account.company_id,
          ad_account_id: account.id,
          external_id: campaign.campaign_id,
          name: campaign.campaign_name,
          platform: 'tiktok' as const,
          status: statusOf(campaign.operation_status, campaign.secondary_status),
          objective: campaign.objective_type ?? null,
        })),
        { onConflict: 'company_id,platform,external_id' },
      )
      .select('id, external_id');

    // Без кампаний строкам статистики некуда лечь, а окно ниже стёрлось бы
    // вчистую. Такую синхронизацию обрываем.
    if (error) throw new Error(`не удалось сохранить кампании: ${error.message}`);

    for (const row of saved ?? []) {
      if (row.external_id) campaignIdByExternal.set(row.external_id, row.id);
    }

    const hiring = campaigns
      .filter((campaign) => !known.has(campaign.campaign_id))
      .filter((campaign) => HIRING_NAME.test(campaign.campaign_name))
      .map((campaign) => campaignIdByExternal.get(campaign.campaign_id))
      .filter(Boolean) as string[];

    if (hiring.length > 0) {
      await supabase.from('campaigns').update({ counted: false }).in('id', hiring);
    }
  }

  // --- 2. Группы объявлений ------------------------------------------------
  const groups = await call<{
    adgroup_id: string;
    adgroup_name: string;
    campaign_id?: string;
    operation_status?: string;
    secondary_status?: string;
  }>('/adgroup/get/', token, { advertiser_id: account.account_id });

  const groupIdByExternal = new Map<string, string>();

  if (groups.length > 0) {
    const { data: saved } = await supabase
      .from('ad_sets')
      .upsert(
        groups.map((group) => ({
          company_id: account.company_id,
          campaign_id: group.campaign_id
            ? (campaignIdByExternal.get(group.campaign_id) ?? null)
            : null,
          external_id: group.adgroup_id,
          name: group.adgroup_name,
          status: statusOf(group.operation_status, group.secondary_status),
        })) as never,
        { onConflict: 'company_id,external_id' },
      )
      .select('id, external_id');

    for (const row of saved ?? []) {
      if (row.external_id) groupIdByExternal.set(row.external_id, row.id);
    }
  }

  // --- 3. Объявления и креативы -------------------------------------------
  // У TikTok объявление и есть креатив: ролик живёт внутри объявления, а не
  // отдельной сущностью, как у Meta. Поэтому на каждое объявление заводим свой
  // креатив — иначе таблица креативов у TikTok осталась бы пустой.
  const ads = await call<{
    ad_id: string;
    ad_name: string;
    campaign_id?: string;
    adgroup_id?: string;
    video_id?: string;
    ad_format?: string;
    ad_text?: string;
    operation_status?: string;
    secondary_status?: string;
  }>('/ad/get/', token, { advertiser_id: account.account_id });

  const creativeIdByAd = new Map<string, string>();

  if (ads.length > 0) {
    const { data: savedCreatives } = await supabase
      .from('creatives')
      .upsert(
        ads.map((ad) => ({
          company_id: account.company_id,
          external_id: ad.ad_id,
          name: ad.ad_name,
          platform: 'tiktok' as const,
          status: statusOf(ad.operation_status, ad.secondary_status),
          format: ad.video_id ? ('video' as const) : ('image' as const),
          video_id: ad.video_id ?? null,
          body: ad.ad_text ?? null,
        })) as never,
        { onConflict: 'company_id,platform,external_id' },
      )
      .select('id, external_id');

    for (const row of savedCreatives ?? []) {
      if (row.external_id) creativeIdByAd.set(row.external_id, row.id);
    }

    await supabase.from('ads').upsert(
      ads.map((ad) => ({
        company_id: account.company_id,
        external_id: ad.ad_id,
        name: ad.ad_name,
        status: statusOf(ad.operation_status, ad.secondary_status),
        creative_id: creativeIdByAd.get(ad.ad_id) ?? null,
        ad_set_id: ad.adgroup_id ? (groupIdByExternal.get(ad.adgroup_id) ?? null) : null,
        campaign_id: ad.campaign_id
          ? (campaignIdByExternal.get(ad.campaign_id) ?? null)
          : null,
      })) as never,
      { onConflict: 'company_id,external_id' },
    );
  }

  // --- 4. Дневная статистика ----------------------------------------------
  const report = await call<{
    dimensions: { ad_id?: string; stat_time_day?: string };
    metrics: Record<string, unknown>;
  }>('/report/integrated/get/', token, {
    advertiser_id: account.account_id,
    report_type: 'BASIC',
    data_level: 'AUCTION_AD',
    dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
    metrics: JSON.stringify([
      'campaign_id',
      'spend',
      'impressions',
      'reach',
      'clicks',
      'conversion',
      'video_play_actions',
      'video_watched_6s',
    ]),
    start_date: since,
    end_date: until,
  });

  const currency = await accountCurrency(supabase, account);

  // Один ролик может крутиться в нескольких объявлениях — складываем, иначе
  // строки подерутся за ключ «креатив + кампания + день».
  const merged = new Map<
    string,
    {
      company_id: string;
      campaign_id: string | null;
      creative_id: string | null;
      platform: 'tiktok';
      currency: string | null;
      date: string;
      spend: number;
      impressions: number;
      reach: number;
      clicks: number;
      ctr: number;
      cpc: number;
      cpm: number;
      leads: number;
      conversations: number;
      cpl: number;
      video_plays: number;
      video_completions: number;
      video_avg_seconds: number;
    }
  >();

  for (const row of report) {
    const adId = row.dimensions.ad_id;
    const day = row.dimensions.stat_time_day?.slice(0, 10);
    if (!adId || !day) continue;

    const creativeId = creativeIdByAd.get(adId) ?? null;
    const campaignExternal = row.metrics.campaign_id;
    const campaignId =
      typeof campaignExternal === 'string'
        ? (campaignIdByExternal.get(campaignExternal) ?? null)
        : null;

    const key = `${creativeId ?? adId}:${campaignId ?? ''}:${day}`;
    const current = merged.get(key) ?? {
      company_id: account.company_id,
      campaign_id: campaignId,
      creative_id: creativeId,
      platform: 'tiktok' as const,
      currency,
      date: day,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      ctr: 0,
      cpc: 0,
      cpm: 0,
      leads: 0,
      conversations: 0,
      cpl: 0,
      video_plays: 0,
      video_completions: 0,
      video_avg_seconds: 0,
    };

    current.spend += num(row.metrics.spend);
    current.impressions += num(row.metrics.impressions);
    current.reach += num(row.metrics.reach);
    current.clicks += num(row.metrics.clicks);
    current.leads += num(row.metrics.conversion);
    current.video_plays += num(row.metrics.video_play_actions);
    current.video_completions += num(row.metrics.video_watched_6s);

    merged.set(key, current);
  }

  const rows = Array.from(merged.values()).map((row) => ({
    ...row,
    spend: round2(row.spend),
    // Производные считаем после сложения: усреднять проценты нельзя.
    ctr: row.impressions ? round4((row.clicks / row.impressions) * 100) : 0,
    cpc: row.clicks ? round2(row.spend / row.clicks) : 0,
    cpm: row.impressions ? round2((row.spend / row.impressions) * 1000) : 0,
    cpl: row.leads ? round2(row.spend / row.leads) : 0,
  }));

  // Окно перезаписываем целиком — так повторный запуск не удваивает дни. Но
  // стирать его, когда писать нечего, нельзя: сбойный ответ унёс бы месяц
  // статистики.
  if (rows.length > 0) {
    await supabase
      .from('ad_metrics')
      .delete()
      .eq('company_id', account.company_id)
      .eq('platform', 'tiktok')
      .gte('date', since)
      .lte('date', until);

    const { error } = await supabase.from('ad_metrics').insert(rows as never);
    if (error) throw new Error(`не удалось сохранить метрики: ${error.message}`);
  }

  return { campaigns: campaigns.length, creatives: ads.length, days };
}

/** Валюта кабинета: в ней придёт расход, в ней же и храним. */
async function accountCurrency(
  supabase: ReturnType<typeof createAdminSupabase>,
  account: Account,
): Promise<string | null> {
  const { data } = await supabase
    .from('ad_accounts')
    .select('currency')
    .eq('id', account.id)
    .maybeSingle();

  return data?.currency ?? null;
}
