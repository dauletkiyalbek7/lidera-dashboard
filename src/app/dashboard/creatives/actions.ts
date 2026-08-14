'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type CreativeState = { error?: string; success?: string };

/** Своё имя ролика для отчётов. Пустое значение возвращает подпись «Видео N». */
export async function renameCreative(
  _prevState: CreativeState,
  formData: FormData,
): Promise<CreativeState> {
  const { company, profile, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };
  if (profile.role !== 'DIRECTOR') return { error: 'Переименовать может директор.' };

  const parsed = z
    .object({
      creativeId: z.string().uuid(),
      label: z.string().trim().max(40, 'Имя длиннее 40 символов не поместится'),
    })
    .safeParse({
      creativeId: formData.get('creativeId'),
      label: formData.get('label') ?? '',
    });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('creatives')
    .update({ label: parsed.data.label || null })
    .eq('id', parsed.data.creativeId)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось сохранить имя.' };

  revalidatePath('/dashboard/creatives');
  revalidatePath(`/dashboard/creatives/${parsed.data.creativeId}`);
  revalidatePath('/dashboard/leads');
  return { success: 'Имя сохранено.' };
}
