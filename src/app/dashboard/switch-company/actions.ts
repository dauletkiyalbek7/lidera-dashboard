'use server';

import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Переключение между проектами одного входа.
 *
 * Право переключиться проверяет база: политика на active_company пропускает
 * только те компании, где у этого пользователя есть действующий профиль.
 * Здесь мы лишь передаём выбор — подставить чужой id бесполезно.
 */
export async function switchCompany(companyId: string): Promise<{ error?: string }> {
  const { userId } = await requireSession();

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('active_company')
    .upsert({ user_id: userId, company_id: companyId, updated_at: new Date().toISOString() });

  if (error) return { error: 'Не удалось переключить проект.' };

  revalidatePath('/dashboard', 'layout');
  return {};
}
