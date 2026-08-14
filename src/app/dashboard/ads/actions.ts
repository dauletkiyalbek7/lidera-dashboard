'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type CampaignState = { error?: string };

/**
 * Включить или выключить кампанию в отчётах.
 *
 * Меняет только то, как платформа считает: в самом рекламном кабинете ничего
 * не трогаем — токен на это и не способен.
 */
export async function setCampaignCounted(
  campaignId: string,
  counted: boolean,
): Promise<CampaignState> {
  const { company, profile, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };
  if (profile.role !== 'DIRECTOR') {
    return { error: 'Менять состав отчётов может директор.' };
  }

  const parsed = z.string().uuid().safeParse(campaignId);
  if (!parsed.success) return { error: 'Некорректная кампания.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('campaigns')
    .update({ counted })
    .eq('id', parsed.data)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось сохранить.' };

  revalidatePath('/dashboard/ads');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/creatives');
  return {};
}
