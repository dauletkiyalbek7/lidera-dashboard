'use server';

import { revalidatePath } from 'next/cache';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
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
  const { company, profile, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  if (profile.role !== 'DIRECTOR') {
    return { error: 'Запускать синхронизацию может только директор.' };
  }

  if (!isMetaConfigured()) {
    return {
      error:
        'Токен Meta не задан на сервере. Добавьте переменную META_ACCESS_TOKEN — до этого данные обновляться не будут.',
    };
  }

  // Кабинеты ищем под пользовательской сессией: RLS не даст взять чужой.
  //
  // Их бывает несколько: у проекта свой кабинет и доля в общем, и это не
  // редкость, а обычный расклад. Раньше здесь стоял запрос на одну строку, и
  // второй кабинет не просто оставался без обновления — запрос отвечал
  // отказом, кнопка писала «кабинет не привязан», и директор искал поломку в
  // привязке, которой не было.
  const supabase = await createServerSupabase();
  const { data: accounts } = await supabase
    .from('ad_accounts')
    .select('id, account_name')
    .eq('company_id', company.id)
    .eq('platform', 'meta')
    .not('account_id', 'is', null)
    .order('created_at');

  if (!accounts || accounts.length === 0) {
    return { error: 'К компании не привязан рекламный кабинет Meta.' };
  }

  const total = { campaigns: 0, days: 0, spend: 0 };
  const failed: string[] = [];

  // По очереди: Meta считает частоту обращений по токену, и два кабинета
  // разом — самый быстрый способ получить отказ.
  for (const account of accounts) {
    try {
      const result = await syncMetaAccount(account.id);
      total.campaigns += result.campaigns;
      total.days += result.days;
      total.spend += result.spend;
    } catch (error) {
      const why = error instanceof Error ? error.message : 'не удалось';
      failed.push(`${account.account_name || 'кабинет'}: ${why}`);
    }
  }

  revalidatePath('/dashboard', 'layout');

  if (failed.length === accounts.length) {
    return { error: `Meta не отдала данные: ${failed[0]}` };
  }

  const done = accounts.length - failed.length;
  const where =
    accounts.length > 1 ? ` из ${done} ${done === 1 ? 'кабинета' : 'кабинетов'}` : '';

  return {
    success:
      `Готово: ${total.campaigns} кампаний, ${total.days} дней${where}, ` +
      `расход ${total.spend.toFixed(2)}. Данные в разделе «Реклама» обновлены.` +
      (failed.length ? ` Не ответил — ${failed.join('; ')}.` : ''),
  };
}
