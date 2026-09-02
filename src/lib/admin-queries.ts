import 'server-only';

import { createAdminSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';

/**
 * Запросы админ-панели. Клиент пользовательский: доступ ко всем компаниям
 * даёт политика is_super_admin(), а не сервисный ключ — так проверка прав
 * остаётся в базе.
 */

export type CompanySummary = CompanyRow & {
  directors: number;
  leads: number;
  sales: number;
  plan: string | null;
};

export async function listCompanies(): Promise<CompanySummary[]> {
  const supabase = await createServerSupabase();

  const [{ data: companies }, { data: profiles }, { data: subscriptions }] =
    await Promise.all([
      supabase.from('companies').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('company_id, role'),
      supabase.from('subscriptions').select('company_id, plan, status'),
    ]);

  const directorCount = new Map<string, number>();
  for (const profile of profiles ?? []) {
    if (profile.role !== 'DIRECTOR' || !profile.company_id) continue;
    directorCount.set(profile.company_id, (directorCount.get(profile.company_id) ?? 0) + 1);
  }

  const plans = new Map(
    (subscriptions ?? []).map((item) => [item.company_id, item.plan] as const),
  );

  const ids = (companies ?? []).map((company) => company.id);

  const [leadCount, saleCount] = await Promise.all([
    countPerCompany(supabase, 'leads', ids),
    countPerCompany(supabase, 'sales', ids),
  ]);

  return (companies ?? []).map((company) => ({
    ...company,
    directors: directorCount.get(company.id) ?? 0,
    leads: leadCount.get(company.id) ?? 0,
    sales: saleCount.get(company.id) ?? 0,
    plan: plans.get(company.id) ?? null,
  }));
}

export async function getCompany(companyId: string) {
  const supabase = await createServerSupabase();

  const [{ data: company }, { data: members }, { data: subscription }] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).maybeSingle(),
    supabase
      .from('profiles')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at'),
    supabase
      .from('subscriptions')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!company) return null;

  const [{ count: leads }, { count: sales }, { count: creatives }] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact' }).eq('company_id', companyId).limit(1),
    supabase.from('sales').select('id', { count: 'exact' }).eq('company_id', companyId).limit(1),
    supabase
      .from('creatives')
      .select('id', { count: 'exact' })
      .eq('company_id', companyId)
      .limit(1),
  ]);

  return {
    company,
    members: (members ?? []) as ProfileRow[],
    subscription,
    counts: { leads: leads ?? 0, sales: sales ?? 0, creatives: creatives ?? 0 },
  };
}

/** Рекламные кабинеты, подключённые к компании. */
export async function getCompanyAdAccounts(companyId: string) {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from('ad_accounts')
    .select('id, account_name, account_id, currency, status')
    .eq('company_id', companyId)
    .order('created_at');

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.account_name,
    accountId: row.account_id,
    currency: row.currency,
    status: row.status,
  }));
}

/**
 * Настройки CAPI компании без самого токена: наружу он не выходит никогда.
 *
 * У таблицы нет политик RLS — она недоступна даже администратору через
 * пользовательский ключ, поэтому читаем её серверным. Страница, которая это
 * вызывает, уже закрыта requireSuperAdmin().
 */
export async function getCapiSettings(companyId: string) {
  const supabase = createAdminSupabase();

  const { data } = await supabase
    .from('capi_settings')
    .select('dataset_id, test_event_code, last_event_at, last_error')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!data) return null;

  return {
    datasetId: data.dataset_id,
    testEventCode: data.test_event_code,
    lastEventAt: data.last_event_at,
    lastError: data.last_error,
  };
}

export async function listAuditLogs(limit = 100) {
  const supabase = await createServerSupabase();

  const [{ data: logs }, { data: companies }] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase.from('companies').select('id, name'),
  ]);

  const names = new Map((companies ?? []).map((item) => [item.id, item.name]));

  return (logs ?? []).map((log) => ({
    ...log,
    companyName: log.company_id ? (names.get(log.company_id) ?? null) : null,
  }));
}

/**
 * Сколько строк у каждой компании.
 *
 * Считает база, а не мы: раньше список тянулся целиком и складывался в
 * памяти, но база отдаёт максимум тысячу строк за запрос и об обрезке молчит.
 * У платформы заявок уже восемь тысяч — в админке компании показывали
 * случайные доли своих цифр, и первая же проверка расходилась с разделом
 * «Лиды».
 *
 * Считаем обычным запросом на одну строку: число приезжает в заголовке
 * ответа, а сами данные не грузятся.
 */
async function countPerCompany(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  table: 'leads' | 'sales',
  companyIds: string[],
): Promise<Map<string, number>> {
  const counts = await Promise.all(
    companyIds.map(async (companyId) => {
      const { count } = await supabase
        .from(table)
        .select('id', { count: 'exact' })
        .eq('company_id', companyId)
        .limit(1);

      return [companyId, count ?? 0] as const;
    }),
  );

  return new Map(counts);
}
