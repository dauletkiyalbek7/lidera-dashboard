import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createServerSupabase } from '@/lib/supabase/server';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';

/**
 * Кабинет какой компании администратор платформы открыл для наблюдения.
 * Только id: сама компания читается из базы под RLS при каждом запросе.
 */
export const VIEW_COMPANY_COOKIE = 'lidera_view_company';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ответ любого действия, которое пытаются выполнить в режиме наблюдения. */
export const VIEW_ONLY_ERROR =
  'Режим наблюдения: администратор платформы видит кабинет только для чтения. ' +
  'Изменения делает директор компании.';

export type SessionContext = {
  userId: string;
  email: string | null;
  profile: ProfileRow;
  company: CompanyRow | null;
  /** Кабинет открыт администратором платформы: смотреть можно, менять — нет. */
  readOnly: boolean;
  /**
   * Карточка сотрудника, если вход выдан менеджеру или продажнику.
   * У директора её нет — он видит компанию целиком.
   */
  employee: { id: string; role: string; fullName: string; telegramLinked: boolean } | null;
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

  // Сотрудник видит только своё. Что именно — решает RLS по этой же карточке,
  // поэтому здесь она нужна лишь для меню и подписей.
  let employee: SessionContext['employee'] = null;
  if (profile.company_id) {
    const { data } = await supabase
      .from('employees')
      .select('id, role, full_name, telegram_user_id')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .maybeSingle();

    employee = data
      ? {
          id: data.id,
          role: data.role,
          fullName: data.full_name,
          telegramLinked: data.telegram_user_id !== null,
        }
      : null;
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    company,
    readOnly: false,
    employee,
  };
}

/** Требует вход. Иначе — редирект на /login с возвратом на исходный путь. */
export async function requireSession(nextPath?: string): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login');
  }
  return context;
}

/**
 * Кабинет компании: доступен директору и сотрудникам активной компании.
 *
 * Администратору платформы кабинет не принадлежит, но он может открыть чужой
 * для наблюдения — тогда возвращаем выбранную компанию с флагом `readOnly`.
 * Данные при этом берутся обычным пользовательским клиентом: право видеть их
 * даёт RLS (`private.is_super_admin()`), а не обход политик.
 */
export async function requireCompanySession(): Promise<
  SessionContext & { company: CompanyRow }
> {
  const context = await requireSession('/dashboard');

  if (context.profile.role === 'SUPER_ADMIN') {
    const observed = await observedCompany();
    if (!observed) redirect('/admin');
    return { ...context, company: observed, readOnly: true };
  }

  if (!context.company) redirect('/login?error=no_company');
  if (context.company.status === 'inactive') redirect('/login?error=company_inactive');

  return context as SessionContext & { company: CompanyRow };
}

/** Компания, выбранная администратором для наблюдения, если выбор ещё в силе. */
async function observedCompany(): Promise<CompanyRow | null> {
  const companyId = (await cookies()).get(VIEW_COMPANY_COOKIE)?.value;
  // Значение приходит из куки, поэтому проверяем форму до запроса в базу.
  if (!companyId || !UUID_PATTERN.test(companyId)) return null;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .maybeSingle();

  return data ?? null;
}

/** Админ-панель платформы. */
/**
 * Рекламные разделы: директор и таргетолог.
 *
 * Реклама, креативы и отправка покупок — работа таргетолога, и без доступа к
 * своим же цифрам он её не сделает. Остальным сотрудникам эти разделы закрыты:
 * менеджеру не нужен бюджет, а продажнику — цена клика.
 */
export async function requireAdsAccess(): Promise<
  SessionContext & { company: CompanyRow }
> {
  const context = await requireCompanySession();
  if (context.employee && context.employee.role !== 'targetolog') {
    redirect('/dashboard/leads');
  }
  return context;
}

/**
 * Раздел только для руководства: директора, РОПа и администратора.
 *
 * Рядового сотрудника уводим к его заявкам. Данные компании и без этого
 * закрыты политиками базы, но показывать менеджеру пустой отчёт по коллегам
 * или чужую выручку незачем — это не его работа.
 */
export async function requireFullAccess(): Promise<
  SessionContext & { company: CompanyRow }
> {
  const context = await requireCompanySession();
  if (context.employee) redirect('/dashboard/leads');
  return context;
}

export async function requireSuperAdmin(): Promise<SessionContext> {
  const context = await requireSession('/admin');
  if (context.profile.role !== 'SUPER_ADMIN') redirect('/dashboard');
  return context;
}
