'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ATTENDANCE_STATUS_ORDER } from '@/lib/attendance';
import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type AttendanceState = { error?: string; success?: string };

const markSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату'),
  status: z.enum(ATTENDANCE_STATUS_ORDER),
  note: z.string().trim().max(200).optional(),
});

/**
 * Ручная отметка в табеле: больничный, отпуск, выходной.
 *
 * Ставится поверх автоматической, но не наоборот — если директор отметил
 * больничный, открытие смены его не затрёт (см. markAttendance в боте).
 */
export async function markAttendance(
  _prevState: AttendanceState,
  formData: FormData,
): Promise<AttendanceState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = markSchema.safeParse({
    employeeId: formData.get('employeeId'),
    date: formData.get('date'),
    status: formData.get('status'),
    note: formData.get('note'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  if (!company.attendance_statuses.includes(parsed.data.status)) {
    return { error: 'Этот статус выключен в настройках компании.' };
  }

  const supabase = await createServerSupabase();

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('id', parsed.data.employeeId)
    .eq('company_id', company.id)
    .maybeSingle();

  if (!employee) return { error: 'Сотрудник не найден.' };

  const { error } = await supabase.from('attendance').upsert(
    {
      company_id: company.id,
      employee_id: parsed.data.employeeId,
      date: parsed.data.date,
      status: parsed.data.status,
      note: parsed.data.note || null,
      source: 'manual',
    },
    { onConflict: 'employee_id,date' },
  );

  if (error) return { error: 'Не удалось сохранить отметку.' };

  revalidatePath('/dashboard/attendance');
  return { success: 'Отметка сохранена.' };
}
