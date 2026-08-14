'use server';

import { z } from 'zod';

import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Сотрудник подключает Telegram себе сам.
 *
 * Раньше ссылку выдавал директор и пересылал её в переписке — лишний шаг и
 * лишний способ потерять токен. Теперь сотрудник заходит в кабинет своим
 * логином и жмёт кнопку: ссылка выдаётся только на его собственную карточку,
 * идентификатор из браузера не принимается вовсе.
 */

const INVITE_TTL_HOURS = 48;

export type LinkState = { error?: string; link?: string; expiresAt?: string };

export async function linkMyTelegram(): Promise<LinkState> {
  const { company, employee, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };
  if (!employee) {
    return { error: 'Эта страница для сотрудников. У вас доступ руководителя.' };
  }

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!botUsername) return { error: 'Бот не настроен: не задано имя бота.' };

  const supabase = await createServerSupabase();
  const now = new Date();

  // Прежние неиспользованные ссылки гасим: старая из переписки не должна
  // остаться рабочей.
  await supabase
    .from('employee_invites')
    .update({ used_at: now.toISOString() })
    .eq('employee_id', employee.id)
    .eq('company_id', company.id)
    .is('used_at', null);

  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);

  const { error } = await supabase.from('employee_invites').insert({
    company_id: company.id,
    employee_id: employee.id,
    token,
    expires_at: expiresAt.toISOString(),
  });

  if (error) return { error: 'Не удалось создать ссылку. Попробуйте ещё раз.' };

  return {
    link: `https://t.me/${botUsername}?start=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Пароль меняет сам сотрудник — директор его не знает и знать не должен. */
export async function changeMyPassword(
  _prev: { error?: string; success?: string },
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const { readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = z
    .string()
    .min(10, 'Пароль короче 10 знаков подобрать слишком легко')
    .max(72, 'Пароль длиннее 72 знаков Supabase не принимает')
    .safeParse(formData.get('password'));

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });

  if (error) return { error: 'Не удалось изменить пароль.' };
  return { success: 'Пароль изменён. В следующий раз входите с новым.' };
}

/** 32 символа из криптографического источника — угадать перебором нереально. */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
