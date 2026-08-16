import 'server-only';

import { syncExchangeRates } from '@/lib/currency';
import { DEFAULT_TIME_ZONE, instantInZone, zonedIsoDate } from '@/lib/period';
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

/**
 * Сколько кабинетов тянем одновременно.
 *
 * Один кабинет занимает около полуминуты, а функции на Vercel отведена
 * минута. Друг друга кабинеты не ждут — время уходит на ответы Meta, а не на
 * работу. Двойку не поднимаем: Meta считает частоту обращений по токену, и
 * пачка параллельных запросов упирается в её ограничение.
 */
const ACCOUNT_CONCURRENCY = 2;

/**
 * Сколько времени готовы потратить на кабинеты.
 *
 * Остаток — запас на ответ. Если запустить кабинет впритык к лимиту функции,
 * его убьют посреди записи: часть таблиц обновится, часть нет, и в отчёте о
 * запуске об этом не будет ни слова. Лучше честно отложить до следующего раза.
 */
const TIME_BUDGET_MS = 40_000;

/**
 * Обращения из переписок. Внутри семейства берём наибольшее, а не сумму:
 * Meta отдаёт одно и то же событие под несколькими именами, и сложение
 * удвоило бы людей.
 */
const CONVERSATION_ACTIONS = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
];

/** Заявки с сайта и из форм — тоже несколько имён одного события. */
const LEAD_ACTIONS = [
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'onsite_web_lead',
  'leadgen.other',
  'onsite_conversion.lead_grouped',
];

/** Валюты, которые платформа умеет пересчитывать (курсы Нацбанка РК). */
const SUPPORTED_CURRENCIES = ['KZT', 'USD', 'EUR', 'RUB'];

/**
 * Разбивка по часам — в поясе рекламного кабинета.
 *
 * Именно она позволяет разложить сутки кабинета по суткам компании: иначе
 * день приходит одним куском и разрезать его нечем.
 */
const HOURLY_BREAKDOWN = 'hourly_stats_aggregated_by_advertiser_time_zone';

/**
 * День компании, на который приходится строка статистики.
 *
 * Meta отдаёт час в виде «23:00:00 - 23:59:59» по времени кабинета. Переводим
 * его в абсолютное время, а оттуда — в дату компании. Кабинет в Asia/Omsk и
 * компания в Asia/Almaty расходятся на час: расход за 23:00 по Алматы Meta
 * относит к следующему дню, а заявки того же часа у нас лежат в текущем.
 *
 * Если пояса не известны или совпадают, день остаётся как пришёл.
 */
function companyDate(
  row: MetaInsight,
  accountTimeZone: string | null,
  companyTimeZone: string,
): string {
  const hour = row[HOURLY_BREAKDOWN]?.slice(0, 5);
  if (!hour || !accountTimeZone || accountTimeZone === companyTimeZone) {
    return row.date_start;
  }

  const moment = instantInZone(row.date_start, hour, accountTimeZone);
  return moment ? zonedIsoDate(moment, companyTimeZone) : row.date_start;
}

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

/**
 * Синхронизация всех компаний, у которых подключён кабинет Meta.
 *
 * Кабинеты идут парами и в порядке давности обновления: если времени на всех
 * не хватило, следующий запуск начнёт с тех, кого отложили, и ни один кабинет
 * не останется без синхронизации навсегда.
 */
export async function syncAllMetaAccounts(): Promise<{
  accounts: MetaSyncResult[];
  errors: { account: string; message: string }[];
  skipped: string[];
}> {
  const startedAt = Date.now();
  const supabase = createAdminSupabase();

  // Демо-компании синхронизировать нечем: их кабинеты выдуманные, и Meta
  // честно отвечает отказом. Ошибка в отчёте о запуске должна означать
  // настоящую проблему, иначе её перестают читать.
  const { data: demoCompanies } = await supabase
    .from('companies')
    .select('id')
    .eq('is_demo', true);

  const demo = new Set((demoCompanies ?? []).map((row) => row.id));

  const { data: allAccounts } = await supabase
    .from('ad_accounts')
    .select('id, company_id, account_id, account_name')
    .eq('platform', 'meta')
    .not('account_id', 'is', null);

  // Отметку о прошлой синхронизации ставит noteSync — по ней и решаем, чья
  // очередь. Кабинет, которого ещё не касались, идёт первым.
  const { data: notes } = await supabase
    .from('integrations')
    .select('company_id, last_sync_at')
    .eq('platform', 'meta');

  const syncedAt = new Map(
    (notes ?? []).map((row) => [row.company_id, row.last_sync_at ?? '']),
  );

  const accounts = (allAccounts ?? [])
    .filter((row) => !demo.has(row.company_id))
    .sort((left, right) =>
      (syncedAt.get(left.company_id) ?? '').localeCompare(
        syncedAt.get(right.company_id) ?? '',
      ),
    );

  const results: MetaSyncResult[] = [];
  const errors: { account: string; message: string }[] = [];
  const skipped: string[] = [];

  // Курсы нужны раньше расходов: без них доллары кабинета не станут тенге.
  try {
    await syncExchangeRates(supabase);
  } catch (error) {
    errors.push({
      account: 'курсы валют',
      message: error instanceof Error ? error.message : 'неизвестная ошибка',
    });
  }

  for (let start = 0; start < accounts.length; start += ACCOUNT_CONCURRENCY) {
    const batch = accounts.slice(start, start + ACCOUNT_CONCURRENCY);

    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skipped.push(...accounts.slice(start).map((row) => row.account_name));
      break;
    }

    const settled = await Promise.allSettled(
      batch.map((account) => syncMetaAccount(account.id)),
    );

    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
        return;
      }

      errors.push({
        account: batch[index].account_name,
        message:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : 'неизвестная ошибка',
      });
    });
  }

  if (skipped.length > 0) {
    console.warn(
      `cron/meta-sync: не хватило времени на кабинеты — ${skipped.join(', ')}`,
    );
  }

  return { accounts: results, errors, skipped };
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
  outcome:
    | { ok: true; result: MetaSyncResult }
    | { ok: false; message: string; transient?: boolean },
) {
  const supabase = createAdminSupabase();

  await supabase.from('integrations').upsert(
    {
      company_id: companyId,
      platform: 'meta',
      account_id: accountId,
      status: outcome.ok || outcome.transient ? 'connected' : 'error',
      last_sync_at: new Date().toISOString(),
      config: outcome.ok
        ? {
            rows: outcome.result.rows,
            days: outcome.result.days,
            campaigns: outcome.result.campaigns,
            spend: outcome.result.spend,
            error: null,
          }
        : outcome.transient
          ? { error: null, warning: outcome.message }
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

  // Кнопка «Обновить» тоже подтягивает курсы: директор нажимает её именно
  // тогда, когда хочет увидеть свежие цифры.
  await syncExchangeRates(supabase).catch(() => null);

  try {
    const result = await pullFromMeta(account);
    await noteSync(account.company_id, account.account_id, { ok: true, result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка';

    // Временный отказ — не повод объявлять кабинет сломанным. Если данные
    // свежие, а Meta просто попросила подождать, подключение исправно:
    // «Ошибка» рядом с кабинетом должна означать, что цифры не идут.
    const transient = isTransient(message) && (await hasFreshData(account.company_id));

    if (!transient) {
      await supabase.from('ad_accounts').update({ status: 'error' }).eq('id', account.id);
    }

    await noteSync(account.company_id, account.account_id, { ok: false, message, transient });
    throw error;
  }
}

/** Ограничение частоты и подобные «попробуйте позже» проходят сами. */
function isTransient(message: string): boolean {
  return /код (1|2|4|17|32|613)\)|limit reached|reduce the amount of data|temporarily/i.test(
    message,
  );
}

/** Есть ли у компании данные за последние сутки. */
async function hasFreshData(companyId: string): Promise<boolean> {
  const supabase = createAdminSupabase();
  const yesterday = isoDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const { count } = await supabase
    .from('ad_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('date', yesterday);

  return (count ?? 0) > 0;
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

  // --- 0. Валюта и часовой пояс кабинета ----------------------------------
  // Валюта: расход приходит в ней, а не в валюте компании — доллары нельзя
  // записать в отчёт тенге, не пересчитав по курсу.
  //
  // Пояс: Meta считает сутки по кабинету. У кабинета в Asia/Omsk (+6) день
  // начинается в 23:00 по Алматы, и расход за этот час попадал бы в отчёт
  // следующего дня, а пришедшие в тот же час заявки — в отчёт текущего.
  // Поменять пояс кабинета в Meta нельзя, поэтому приводим цифры мы.
  const [profile] = await graph<{ currency?: string; timezone_name?: string }>(
    `${GRAPH}/${actId}?fields=currency,timezone_name&access_token=${token}`,
    { single: true },
  );
  const accountCurrency = SUPPORTED_CURRENCIES.includes(profile?.currency ?? '')
    ? (profile?.currency as string)
    : null;

  const accountTimeZone = profile?.timezone_name ?? null;

  if (accountCurrency || accountTimeZone) {
    await supabase
      .from('ad_accounts')
      .update({
        ...(accountCurrency ? { currency: accountCurrency } : {}),
        ...(accountTimeZone ? { timezone: accountTimeZone } : {}),
      })
      .eq('id', account.id);
  }

  const { data: companyRow } = await supabase
    .from('companies')
    .select('timezone')
    .eq('id', account.company_id)
    .maybeSingle();

  const companyTimeZone = companyRow?.timezone ?? DEFAULT_TIME_ZONE;

  // --- 1. Номера WhatsApp: они живут в настройках групп объявлений ---------
  const numberByCampaign = new Map<string, string>();
  const adSets = await graph<{ campaign_id?: string; promoted_object?: { whatsapp_phone_number?: string } }>(
    `${GRAPH}/${actId}/adsets?fields=campaign_id,promoted_object&limit=100&access_token=${token}`,
  );
  for (const adSet of adSets) {
    const number = adSet.promoted_object?.whatsapp_phone_number;
    if (adSet.campaign_id && number) numberByCampaign.set(adSet.campaign_id, number);
  }

  // --- 2. Кампании --------------------------------------------------------
  const campaigns = await graph<{ id: string; name: string; status: string; objective?: string }>(
    `${GRAPH}/${actId}/campaigns?fields=name,status,objective&limit=100&access_token=${token}`,
  );

  // Пишем одной пачкой: в крупном кабинете кампаний сотни, и запись по одной
  // не укладывается в отведённое функции время.
  const campaignIdByExternal = new Map<string, string>();

  if (campaigns.length > 0) {
    const { data: savedCampaigns } = await supabase
      .from('campaigns')
      .upsert(
        campaigns.map((campaign) => ({
          company_id: account.company_id,
          ad_account_id: account.id,
          external_id: campaign.id,
          name: campaign.name,
          platform: 'meta' as const,
          status: campaignStatus(campaign.status),
          objective: campaign.objective ?? null,
          // Номер не затираем: если Meta его не отдала, остаётся прежний.
          ...(numberByCampaign.has(campaign.id)
            ? { whatsapp_number: numberByCampaign.get(campaign.id) }
            : {}),
        })),
        { onConflict: 'company_id,platform,external_id' },
      )
      .select('id, external_id');

    for (const row of savedCampaigns ?? []) {
      if (row.external_id) campaignIdByExternal.set(row.external_id, row.id);
    }
  }

  // --- 3. Статистика по объявлениям ---------------------------------------
  // Идём на уровень объявления: только там видно, какой креатив принёс
  // переписки. Период режем неделями — за месяц разом крупный кабинет
  // отвечает отказом «слишком много данных».
  //
  // Запросов два, и это не дублирование:
  //   почасовой — то, что складывается (расход, показы, клики, заявки).
  //     Разбивка по часам и позволяет разложить сутки кабинета по нашим;
  //   дневной — охват и среднее время просмотра. Охват это число людей, а
  //     не сумма: один и тот же человек виден в нескольких часах, и сложение
  //     часов дало бы цифру больше правды. Такие метрики оставляем дневными.
  const windows = weekWindows(since, until);

  const [hourlyPages, dailyPages] = await Promise.all([
    Promise.all(
      windows.map((window) =>
        graph<MetaInsight>(
          `${GRAPH}/${actId}/insights?level=ad&time_increment=1` +
            `&breakdowns=${HOURLY_BREAKDOWN}` +
            `&fields=ad_id,campaign_id,spend,impressions,clicks,actions,date_start,` +
            `video_play_actions,video_p100_watched_actions` +
            `&time_range=${encodeURIComponent(JSON.stringify(window))}` +
            `&limit=500&access_token=${token}`,
        ),
      ),
    ),
    Promise.all(
      windows.map((window) =>
        graph<MetaInsight>(
          `${GRAPH}/${actId}/insights?level=ad&time_increment=1` +
            `&fields=ad_id,campaign_id,reach,date_start,video_avg_time_watched_actions` +
            `&time_range=${encodeURIComponent(JSON.stringify(window))}` +
            `&limit=100&access_token=${token}`,
        ),
      ),
    ),
  ]);

  const insights = hourlyPages.flat();
  const dailyInsights = dailyPages.flat();

  // --- 4. Объявления и креативы -------------------------------------------
  // Забираем только те объявления, что за период работали: в кабинете их
  // могут быть тысячи, и тянуть все — верный способ получить отказ.
  const workingAdIds = Array.from(
    new Set(
      [...insights, ...dailyInsights]
        .map((row) => row.ad_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const ads = await adsByIds<MetaAd>(
    actId,
    workingAdIds,
    'name,status,campaign_id,' +
      'creative{id,name,object_type,video_id,image_url,thumbnail_url,object_story_spec}',
    token,
  );

  const creativeIdByAd = new Map<string, string>();
  const adsByCreative = new Map<string, string[]>();
  const creativeRows = new Map<string, Record<string, unknown>>();

  for (const ad of ads) {
    const creative = ad.creative;
    if (!creative) continue;

    const story = creative.object_story_spec;
    const videoData = story?.video_data;
    const linkData = story?.link_data;

    // Видео берём из object_story_spec: у самого креатива лежит служебная
    // копия, к которой у приложения нет доступа.
    const videoId = videoData?.video_id ?? creative.video_id ?? null;

    adsByCreative.set(creative.id, [...(adsByCreative.get(creative.id) ?? []), ad.id]);
    creativeRows.set(creative.id, {
      company_id: account.company_id,
      external_id: creative.id,
      name: videoData?.title || linkData?.name || creative.name || ad.name,
      platform: 'meta' as const,
      format: videoId ? 'video' : 'image',
      status: adStatus(ad.status),
      video_id: videoId,
      title: videoData?.title ?? linkData?.name ?? null,
      body: videoData?.message ?? linkData?.message ?? null,
      // Обложка — полноразмерный кадр объявления, а не превью 64×64,
      // которое Meta обрезает по центру и режет людям лица.
      thumbnail_url:
        videoData?.image_url ?? linkData?.picture ?? creative.image_url ?? null,
    });
  }

  if (creativeRows.size > 0) {
    const { data: savedCreatives } = await supabase
      .from('creatives')
      .upsert(Array.from(creativeRows.values()) as never, {
        onConflict: 'company_id,platform,external_id',
      })
      .select('id, external_id');

    for (const row of savedCreatives ?? []) {
      for (const adId of adsByCreative.get(row.external_id ?? '') ?? []) {
        creativeIdByAd.set(adId, row.id);
      }
    }
  }

  // Сами объявления тоже сохраняем: по их номеру заявка с сайта находит свой
  // креатив. Без этой таблицы метка {{ad.id}} в ссылке ни с чем не сходится.
  const adRows = ads
    .filter((ad) => ad.id)
    .map((ad) => ({
      company_id: account.company_id,
      external_id: ad.id,
      name: ad.name || `Объявление ${ad.id}`,
      status: adStatus(ad.status),
      creative_id: creativeIdByAd.get(ad.id) ?? null,
      campaign_id: ad.campaign_id ? (campaignIdByExternal.get(ad.campaign_id) ?? null) : null,
    }));

  if (adRows.length > 0) {
    await supabase.from('ads').upsert(adRows, { onConflict: 'company_id,external_id' });
  }

  // --- 5. Складываем строки метрик ----------------------------------------
  // Один креатив может крутиться в нескольких объявлениях — складываем,
  // иначе строки подерутся за уникальный ключ «креатив + день».
  const merged = new Map<string, MetricRow>();

  // Те же часы, сложенные по календарю кабинета: этим числом директор сверяется
  // с Ads Manager, и оно намеренно не совпадает с нашими сутками.
  const accountDays = new Map<string, AccountDayRow>();

  for (const row of insights) {
    const campaignId = row.campaign_id ? campaignIdByExternal.get(row.campaign_id) : null;
    if (!campaignId) continue;

    const spend = Number(row.spend ?? 0);
    // В одном кабинете рядом живут кампании на сайт и кампании в переписки:
    // заявки и написавшие — разные люди, поэтому их складываем. Раньше при
    // наличии переписок заявки с сайта терялись целиком.
    const conversations = actionValue(row.actions, CONVERSATION_ACTIONS);
    const leads = conversations + actionValue(row.actions, LEAD_ACTIONS);

    const accountDay = accountDays.get(row.date_start) ?? {
      company_id: account.company_id,
      ad_account_id: account.id,
      platform: 'meta' as const,
      date: row.date_start,
      leads: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      currency: accountCurrency,
    };
    accountDay.leads += leads;
    accountDay.spend += spend;
    accountDay.impressions += Number(row.impressions ?? 0);
    accountDay.clicks += Number(row.clicks ?? 0);
    accountDays.set(row.date_start, accountDay);

    // Час кабинета переносим в наши сутки. Строка без часа (Meta не отдала
    // разбивку) остаётся на своём дне — это лучше, чем потерять её.
    const date = companyDate(row, accountTimeZone, companyTimeZone);
    // Крайние дни собрались бы из одного часа: остальные их часы лежат за
    // границей запрошенного окна. Такой огрызок в отчёт не пускаем — заодно
    // это держит записанные дни внутри окна, которое ниже перезаписывается.
    if (date < since || date > until) continue;

    const creativeId = row.ad_id ? (creativeIdByAd.get(row.ad_id) ?? null) : null;
    const key = `${creativeId ?? 'нет'}|${campaignId}|${date}`;

    const plays = actionValue(row.video_play_actions, ['video_view']);
    const completions = actionValue(row.video_p100_watched_actions, ['video_view']);

    const current = merged.get(key) ?? {
      company_id: account.company_id,
      currency: accountCurrency,
      campaign_id: campaignId,
      creative_id: creativeId,
      platform: 'meta' as const,
      date,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      ctr: 0,
      cpc: 0,
      cpm: 0,
      leads: 0,
      cpl: 0,
      video_plays: 0,
      video_completions: 0,
      video_avg_seconds: 0,
    };

    current.spend += spend;
    current.impressions += Number(row.impressions ?? 0);
    current.clicks += Number(row.clicks ?? 0);
    current.leads += leads;
    current.video_plays += plays;
    current.video_completions += completions;

    merged.set(key, current);
  }

  // Охват и среднее время просмотра — из дневного запроса. По часам их не
  // разложить, поэтому день кабинета кладём на одноимённый наш день: из его
  // 24 часов 23 приходятся именно на него.
  for (const row of dailyInsights) {
    const campaignId = row.campaign_id ? campaignIdByExternal.get(row.campaign_id) : null;
    if (!campaignId) continue;

    const creativeId = row.ad_id ? (creativeIdByAd.get(row.ad_id) ?? null) : null;
    const current = merged.get(`${creativeId ?? 'нет'}|${campaignId}|${row.date_start}`);
    if (!current) continue;

    current.reach += Number(row.reach ?? 0);
    // Секунды уже усреднены Meta: наибольшее из объявлений, а не сумма.
    current.video_avg_seconds = Math.max(
      current.video_avg_seconds,
      actionValue(row.video_avg_time_watched_actions, ['video_view']),
    );
  }

  const rows = Array.from(merged.values()).map((row) => ({
    ...row,
    spend: round2(row.spend),
    // Производные пересчитываем после сложения: усреднять проценты нельзя.
    ctr: row.impressions ? round4((row.clicks / row.impressions) * 100) : 0,
    cpc: row.clicks ? round2(row.spend / row.clicks) : 0,
    cpm: row.impressions ? round2((row.spend / row.impressions) * 1000) : 0,
    cpl: row.leads ? round2(row.spend / row.leads) : 0,
  }));

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

  // Итоги по календарю кабинета. Крайние дни окна тут оставляем как есть: это
  // ровно то, что показывает Ads Manager за те же даты, а огрызков не бывает —
  // сутки кабинета целиком лежат внутри запрошенного периода.
  const accountDayRows = Array.from(accountDays.values()).map((row) => ({
    ...row,
    spend: round2(row.spend),
  }));

  if (accountDayRows.length > 0) {
    const { error } = await supabase
      .from('ad_account_days')
      .upsert(accountDayRows, { onConflict: 'ad_account_id,date' });
    if (error) {
      throw new Error(`не удалось сохранить сутки кабинета: ${error.message}`);
    }
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

type AccountDayRow = {
  company_id: string;
  ad_account_id: string;
  platform: 'meta';
  date: string;
  leads: number;
  spend: number;
  impressions: number;
  clicks: number;
  currency: string | null;
};

type MetricRow = {
  company_id: string;
  campaign_id: string;
  creative_id: string | null;
  platform: 'meta';
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
  video_plays: number;
  video_completions: number;
  video_avg_seconds: number;
};

type MetaAd = {
  id: string;
  name: string;
  status: string;
  campaign_id?: string;
  creative?: {
    id: string;
    name?: string;
    object_type?: string;
    video_id?: string;
    image_url?: string;
    thumbnail_url?: string;
    object_story_spec?: {
      video_data?: {
        video_id?: string;
        title?: string;
        message?: string;
        image_url?: string;
      };
      link_data?: {
        name?: string;
        message?: string;
        picture?: string;
      };
    };
  };
};

type MetaInsight = {
  ad_id?: string;
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
  video_play_actions?: { action_type: string; value: string }[];
  video_p100_watched_actions?: { action_type: string; value: string }[];
  video_avg_time_watched_actions?: { action_type: string; value: string }[];
  /** Час кабинета в виде «23:00:00 - 23:59:59» — приходит с разбивкой. */
  [HOURLY_BREAKDOWN]?: string;
};

/** Сумма нужных действий из массива actions. Первое совпадение и есть результат. */
/**
 * Значение семейства событий: берём наибольшее из перечисленных типов.
 *
 * Meta присылает одно и то же действие под разными именами («lead»,
 * «offsite_conversion.fb_pixel_lead», «onsite_web_lead» — это одна и та же
 * заявка), поэтому суммировать их нельзя.
 */
function actionValue(
  actions: { action_type: string; value: string }[] | undefined,
  types: string[],
): number {
  if (!actions) return 0;

  let best = 0;
  for (const type of types) {
    const found = actions.find((action) => action.action_type === type);
    if (found) best = Math.max(best, Number(found.value) || 0);
  }
  return best;
}

function adStatus(status: string): 'active' | 'paused' | 'archived' {
  return campaignStatus(status);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function campaignStatus(status: string): 'active' | 'paused' | 'archived' {
  if (status === 'ACTIVE') return 'active';
  if (status === 'ARCHIVED' || status === 'DELETED') return 'archived';
  return 'paused';
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Разбивка периода на недели: крупные кабинеты не отдают месяц за раз. */
function weekWindows(since: string, until: string): { since: string; until: string }[] {
  const windows: { since: string; until: string }[] = [];
  const end = new Date(`${until}T00:00:00Z`);
  const cursor = new Date(`${since}T00:00:00Z`);

  while (cursor <= end) {
    const stop = new Date(cursor);
    stop.setUTCDate(stop.getUTCDate() + 6);
    windows.push({
      since: isoDate(cursor),
      until: isoDate(stop < end ? stop : end),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return windows;
}

/**
 * Объявления по списку идентификаторов.
 *
 * Забираем только те, что за период работали: в кабинете их могут быть тысячи.
 * Просить их через `?ids=` нельзя — в свежих версиях API этот параметр убрали,
 * поэтому идём по обычному списку объявлений с фильтром «идентификатор из
 * списка».
 */
async function adsByIds<T>(
  actId: string,
  ids: string[],
  fields: string,
  token: string,
  batchSize = 50,
): Promise<T[]> {
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += batchSize) {
    batches.push(ids.slice(start, start + batchSize));
  }

  const results: T[][] = [];

  // Пачки идут по очереди: параллельные запросы к крупному кабинету упираются
  // в ограничение частоты, и Meta отвечает отказом всему запуску.
  for (const batch of batches) {
    const filtering = JSON.stringify([
      { field: 'ad.id', operator: 'IN', value: batch },
    ]);

    results.push(
      await graph<T>(
        `${GRAPH}/${actId}/ads?fields=${encodeURIComponent(fields)}` +
          `&filtering=${encodeURIComponent(filtering)}` +
          `&limit=${batchSize}&access_token=${token}`,
      ),
    );
  }

  return results.flat();
}

/**
 * Запрос к Graph API со сквозной постраничкой.
 * Ошибку Meta пробрасываем текстом: «токен истёк» должно быть видно сразу,
 * а не превращаться в пустой отчёт.
 */
async function graph<T>(url: string, options?: { single?: boolean }): Promise<T[]> {
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

    // Запрос свойств самого объекта (например, валюты кабинета) отдаёт объект,
    // а не список: постраничка тут не при чём.
    if (options?.single) return [payload as unknown as T];

    items.push(...(payload.data ?? []));
    next = payload.paging?.next ?? null;

    // Защита от бесконечной постранички при неожиданном ответе.
    if (items.length > 20000) break;
  }

  return items;
}
