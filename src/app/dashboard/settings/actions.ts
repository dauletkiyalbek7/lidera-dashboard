'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type SettingsState = { error?: string; success?: string };

const companySchema = z.object({
  name: z.string().trim().min(2, 'Название слишком короткое').max(120),
  director_name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  funnel_type: z.enum(['trial', 'direct']),
});

/** Реквизиты компании правит только директор — это же ограничение стоит в RLS. */
export async function updateCompany(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { company, profile } = await requireCompanySession();

  if (profile.role !== 'DIRECTOR') {
    return { error: 'Изменять данные компании может только директор.' };
  }

  const parsed = companySchema.safeParse({
    name: formData.get('name'),
    director_name: formData.get('director_name'),
    phone: formData.get('phone'),
    funnel_type: formData.get('funnel_type'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('companies')
    .update({
      name: parsed.data.name,
      director_name: parsed.data.director_name || null,
      phone: parsed.data.phone || null,
      funnel_type: parsed.data.funnel_type,
    })
    .eq('id', company.id);

  if (error) {
    return { error: 'Не удалось сохранить изменения.' };
  }

  revalidatePath('/dashboard', 'layout');
  return { success: 'Данные компании обновлены.' };
}
