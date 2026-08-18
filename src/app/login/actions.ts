'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { publicEnv } from '@/lib/env';
import { createServerSupabase } from '@/lib/supabase/server';

export type AuthFormState = { error?: string; success?: string };

const credentialsSchema = z.object({
  email: z.string().trim().min(1, 'Укажите email').email('Некорректный email'),
  password: z.string().min(1, 'Введите пароль'),
});

const emailSchema = z.object({
  email: z.string().trim().min(1, 'Укажите email').email('Некорректный email'),
});

const passwordSchema = z
  .object({
    password: z.string().min(8, 'Пароль должен быть не короче 8 символов'),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: 'Пароли не совпадают',
    path: ['confirm'],
  });

/** Вход по email и паролю через Supabase Auth. */
export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    // Не раскрываем, существует ли пользователь.
    return { error: 'Неверный email или пароль' };
  }

  // Профилей у входа может быть несколько — по одному на проект. Берём тот
  // же, что выберет сессия: самый старый, если проект ещё не выбирали.
  // Требовать здесь ровно одну строку нельзя — владелец двух проектов просто
  // не смог бы войти.
  const { data: profiles } = await supabase
    .from('profiles')
    .select('role, status, company_id')
    .eq('user_id', data.user.id)
    .eq('status', 'active')
    .order('created_at')
    .limit(1);

  const profile = profiles?.[0];

  if (!profile) {
    await supabase.auth.signOut();
    return {
      error: 'Учётная запись не активна. Обратитесь к администратору Lidera.',
    };
  }

  const requestedNext = String(formData.get('next') ?? '');
  const destination = safeNext(requestedNext, profile.role === 'SUPER_ADMIN');

  revalidatePath('/', 'layout');
  redirect(destination);
}

/** Письмо для восстановления пароля. */
export async function requestPasswordReset(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createServerSupabase();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/reset-password`,
  });

  // Ответ одинаков независимо от того, есть ли такой email в базе.
  return {
    success:
      'Если такой email зарегистрирован в Lidera, письмо со ссылкой уже отправлено.',
  };
}

/** Установка нового пароля после перехода по ссылке из письма. */
export async function updatePassword(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Ссылка недействительна или устарела. Запросите новую.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: 'Не удалось сохранить пароль. Попробуйте ещё раз.' };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

/**
 * Разрешаем возврат только на внутренние пути — чтобы параметр `next`
 * нельзя было использовать для открытого редиректа.
 */
function safeNext(next: string, isSuperAdmin: boolean): string {
  const fallback = isSuperAdmin ? '/admin' : '/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (next === '/login') return fallback;
  if (!isSuperAdmin && next.startsWith('/admin')) return fallback;
  return next;
}
