import 'server-only';

import { redirect } from 'next/navigation';

import { createServerSupabase } from '@/lib/supabase/server';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';

export type SessionContext = {
  userId: string;
  email: string | null;
  profile: ProfileRow;
  company: CompanyRow | null;
};

/**
 * Текущий пользователь вместе с профилем и компанией.
 * Возвращает null, если сессии нет или профиль не заведён.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || profile.status !== 'active') return null;

  let company: CompanyRow | null = null;
  if (profile.company_id) {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .eq('id', profile.company_id)
      .maybeSingle();
    company = data ?? null;
  }

  return { userId: user.id, email: user.email ?? null, profile, company };
}

/** Требует вход. Иначе — редирект на /login с возвратом на исходный путь. */
export async function requireSession(nextPath?: string): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login');
  }
  return context;
}

/** Кабинет компании: доступен директору и сотрудникам активной компании. */
export async function requireCompanySession(): Promise<
  SessionContext & { company: CompanyRow }
> {
  const context = await requireSession('/dashboard');

  // Платформенному администратору кабинет компании не принадлежит.
  if (context.profile.role === 'SUPER_ADMIN') redirect('/admin');

  if (!context.company) redirect('/login?error=no_company');
  if (context.company.status === 'inactive') redirect('/login?error=company_inactive');

  return context as SessionContext & { company: CompanyRow };
}

/** Админ-панель платформы. */
export async function requireSuperAdmin(): Promise<SessionContext> {
  const context = await requireSession('/admin');
  if (context.profile.role !== 'SUPER_ADMIN') redirect('/dashboard');
  return context;
}
