'use server';

import { revalidatePath } from 'next/cache';

import { requireCompanySession } from '@/lib/auth';
import { isMetaConfigured, syncMetaAccount } from '@/lib/meta-sync';
import { createServerSupabase } from '@/lib/supabase/server';

export type SyncState = { error?: string; success?: string };

/**
 * Ручной запуск синхронизации с Meta.
 *
 * Ночного расписания достаточно для работы, но кнопка нужна для другого:
 * директор должен сам, без чьей-либо помощи, проверить связь и увидеть текст
 * ошибки, если токен отозвали или срок доступа истёк.
 */
export async function syncMetaNow(): Promise<SyncState> {
  const { company, profile } = await requireCompanySession();

  if (profile.role !== 'DIRECTOR') {
    return { error: 'Запускать синхронизацию может только директор.' };
  }

  if (!isMetaConfigured()) {
    return {
      error:
        'Токен Meta не задан на сервере. Добавьте переменную META_ACCESS_TOKEN — до этого данные обновляться не будут.',
    };
  }

  // Кабинет ищем под пользовательской сессией: RLS не даст взять чужой.
  const supabase = await createServerSupabase();
  const { data: account } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('company_id', company.id)
    .eq('platform', 'meta')
    .not('account_id', 'is', null)
    .maybeSingle();

  if (!account) {
    return { error: 'К компании не привязан рекламный кабинет Meta.' };
  }

  try {
    const result = await syncMetaAccount(account.id);
    revalidatePath('/dashboard', 'layout');
    return {
      success:
        `Готово: ${result.campaigns} кампаний, ${result.days} дней, ` +
        `расход ${result.spend}. Данные в разделе «Реклама» обновлены.`,
    };
  } catch (error) {
    revalidatePath('/dashboard', 'layout');
    return {
      error:
        error instanceof Error
          ? `Meta не отдала данные: ${error.message}`
          : 'Не удалось синхронизировать.',
    };
  }
}
