'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { encryptSecret } from '@/lib/secrets';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { syncAllTikTokAccounts } from '@/lib/tiktok-sync';

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

  const saved = (existing?.config ?? null) as { token_encrypted?: string } | null;

  // Пустое поле токена означает «оставить прежний» — иначе при каждой правке
  // названия кабинета токен пришлось бы вводить заново.
  if (!parsed.data.token && !saved?.token_encrypted) {
    return { error: 'Для первого подключения нужен токен доступа.' };
  }

  const { error: integrationError } = await supabase.from('integrations').upsert(
    {
      company_id: company.id,
      platform: 'tiktok',
      account_id: parsed.data.advertiserId,
      status: 'connected',
      config: {
        token_encrypted: parsed.data.token
          ? encryptSecret(parsed.data.token)
          : saved!.token_encrypted,
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

  return { success: 'Кабинет подключён. Первая загрузка пойдёт ближайшей синхронизацией.' };
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

  const result = await syncAllTikTokAccounts({ windowDays: 7 });

  revalidatePath('/dashboard/integrations/tiktok');
  revalidatePath('/dashboard/creatives');
  revalidatePath('/dashboard/ads');

  if (result.errors.length > 0) {
    return { error: `TikTok: ${result.errors[0].message}` };
  }

  const done = result.synced[0];
  if (!done) return { error: 'Подключённых кабинетов TikTok нет.' };

  return {
    success: `Загружено: кампаний ${done.campaigns}, объявлений ${done.creatives}.`,
  };
}
