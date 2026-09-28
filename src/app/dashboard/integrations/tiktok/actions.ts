'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { encryptSecret } from '@/lib/secrets';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { syncAllTikTokAccounts } from '@/lib/tiktok-sync';
import { syncAllWindsorAccounts } from '@/lib/windsor-sync';

/**
 * Подключение рекламного кабинета TikTok.
 *
 * Токен приходит из формы, шифруется и ложится в `integrations.config`.
 * Наружу он не возвращается никогда: страница знает только, задан он или нет.
 *
 * Номер кабинета живёт отдельно, в `ad_accounts`, — там же, где кабинеты
 * Meta. Синхронизация ходит именно по ним, и заводить для TikTok вторую,
 * похожую таблицу значило бы раздвоить модель ради одной площадки.
 */

export type TikTokState = { error?: string; success?: string };

const settingsSchema = z.object({
  advertiserId: z
    .string()
    .trim()
    .regex(/^\d{10,25}$/, 'Номер кабинета — только цифры'),
  accountName: z.string().trim().min(1, 'Назовите кабинет').max(80),
  currency: z.enum(['KZT', 'USD', 'EUR', 'RUB']),
  token: z.string().trim().min(20, 'Токен слишком короткий').optional().or(z.literal('')),
  windsorKey: z
    .string()
    .trim()
    .min(10, 'Ключ Windsor слишком короткий')
    .optional()
    .or(z.literal('')),
});

export async function saveTikTokSettings(
  _prev: TikTokState,
  formData: FormData,
): Promise<TikTokState> {
  const { company, readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = settingsSchema.safeParse({
    advertiserId: formData.get('advertiserId'),
    accountName: formData.get('accountName'),
    currency: formData.get('currency'),
    token: formData.get('token'),
    windsorKey: formData.get('windsorKey'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Проверьте поля.' };
  }

  const supabase = createAdminSupabase();

  const { data: existing } = await supabase
    .from('integrations')
    .select('config')
    .eq('company_id', company.id)
    .eq('platform', 'tiktok')
    .maybeSingle();

  const saved = (existing?.config ?? null) as {
    token_encrypted?: string;
    windsor_key_encrypted?: string;
  } | null;

  // Пустое поле ключа означает «оставить прежний» — иначе при каждой правке
  // названия кабинета ключи пришлось бы вводить заново.
  const token = parsed.data.token
    ? encryptSecret(parsed.data.token)
    : (saved?.token_encrypted ?? null);

  const windsorKey = parsed.data.windsorKey
    ? encryptSecret(parsed.data.windsorKey)
    : (saved?.windsor_key_encrypted ?? null);

  // Дорог к кабинету две, и хватает любой: токен TikTok даёт разбивку по
  // роликам, ключ Windsor — только по объявлениям, зато выдаётся сразу.
  if (!token && !windsorKey) {
    return { error: 'Нужен токен TikTok или ключ Windsor — хотя бы один.' };
  }

  const { error: integrationError } = await supabase.from('integrations').upsert(
    {
      company_id: company.id,
      platform: 'tiktok',
      account_id: parsed.data.advertiserId,
      status: 'connected',
      config: {
        ...(token ? { token_encrypted: token } : {}),
        ...(windsorKey ? { windsor_key_encrypted: windsorKey } : {}),
      },
    } as never,
    { onConflict: 'company_id,platform' },
  );

  if (integrationError) return { error: 'Не удалось сохранить подключение.' };

  // Кабинет заводим или обновляем — по нему пойдёт синхронизация.
  const { data: account } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('company_id', company.id)
    .eq('platform', 'tiktok')
    .maybeSingle();

  const payload = {
    company_id: company.id,
    platform: 'tiktok' as const,
    account_id: parsed.data.advertiserId,
    account_name: parsed.data.accountName,
    currency: parsed.data.currency,
    status: 'connected' as const,
  };

  const { error: accountError } = account
    ? await supabase.from('ad_accounts').update(payload).eq('id', account.id)
    : await supabase.from('ad_accounts').insert(payload);

  if (accountError) return { error: 'Не удалось сохранить кабинет.' };

  revalidatePath('/dashboard/integrations/tiktok');
  revalidatePath('/dashboard/integrations');

  return {
    success: token
      ? 'Кабинет подключён напрямую. Первая загрузка пойдёт ближайшей синхронизацией.'
      : 'Кабинет подключён через Windsor. Первая загрузка пойдёт ближайшей синхронизацией.',
  };
}

/**
 * Загрузить сейчас, не дожидаясь двухчасового цикла.
 *
 * Нужна ровно в момент подключения: человек ввёл ключи и хочет увидеть, что
 * они рабочие, а не узнать об ошибке через два часа из пустого отчёта.
 */
export async function syncTikTokNow(): Promise<TikTokState> {
  const { readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  // Прямой кабинет подробнее, поэтому он первый. Компании без токена уйдут в
  // Windsor: он вернёт те же деньги, но на уровне объявлений.
  const direct = await syncAllTikTokAccounts({ windowDays: 7 });
  const windsor = await syncAllWindsorAccounts({ windowDays: 7 });

  revalidatePath('/dashboard/integrations/tiktok');
  revalidatePath('/dashboard/creatives');
  revalidatePath('/dashboard/ads');

  const failure = direct.errors[0] ?? windsor.errors[0];
  if (failure) return { error: `TikTok: ${failure.message}` };

  const done = direct.synced[0] ?? windsor.synced[0];
  if (!done) return { error: 'Подключённых кабинетов TikTok нет.' };

  return {
    success: `Загружено: кампаний ${done.campaigns}, объявлений ${done.creatives}.`,
  };
}
