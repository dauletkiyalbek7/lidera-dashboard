'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireSuperAdmin, VIEW_COMPANY_COOKIE } from '@/lib/auth';
import { sendPurchase } from '@/lib/capi';
import { syncMetaAccount } from '@/lib/meta-sync';
import { encryptSecret, secretHint } from '@/lib/secrets';
import { createAdminSupabase, isAdminConfigured } from '@/lib/supabase/admin';

export type AdminState = { error?: string; success?: string };

/** Наблюдение живёт рабочий день: забытая вкладка не остаётся открытой навсегда. */
const OBSERVE_SESSION_SECONDS = 8 * 60 * 60;

const MISSING_KEY_ERROR =
  'Не задан SUPABASE_SERVICE_ROLE_KEY. Добавьте ключ в переменные окружения — ' +
  'без него платформа не может создавать учётные записи.';

const createCompanySchema = z.object({
  name: z.string().trim().min(2, 'Укажите название компании').max(120),
  directorName: z.string().trim().min(2, 'Укажите имя директора').max(120),
  email: z.string().trim().toLowerCase().email('Некорректный email директора'),
  phone: z.string().trim().max(40).optional(),
  password: z.string().min(8, 'Временный пароль — минимум 8 символов').max(72),
  status: z.enum(['active', 'trial', 'inactive']),
  plan: z.enum(['trial', 'start', 'pro', 'enterprise']),
  funnelType: z.enum(['trial', 'direct']),
});

/**
 * Создание компании вместе с её директором.
 *
 * Порядок важен: сначала компания, затем пользователь Auth, затем профиль,
 * который их связывает. Если шаг падает — откатываем созданное вручную,
 * чтобы не оставлять «половинчатых» арендаторов.
 */
export async function createCompany(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const admin = await requireSuperAdmin();
  if (!isAdminConfigured()) return { error: MISSING_KEY_ERROR };

  const parsed = createCompanySchema.safeParse({
    name: formData.get('name'),
    directorName: formData.get('directorName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    password: formData.get('password'),
    status: formData.get('status'),
    plan: formData.get('plan'),
    funnelType: formData.get('funnelType'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const input = parsed.data;
  const supabase = createAdminSupabase();

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert({
      name: input.name,
      director_name: input.directorName,
      phone: input.phone || null,
      email: input.email,
      status: input.status,
      funnel_type: input.funnelType,
    })
    .select('id, lead_webhook_key')
    .single();

  if (companyError || !company) {
    return { error: 'Не удалось создать компанию. Попробуйте ещё раз.' };
  }

  const { data: created, error: userError } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.directorName },
  });

  if (userError || !created.user) {
    await supabase.from('companies').delete().eq('id', company.id);
    return {
      error:
        userError?.message.includes('already')
          ? 'Пользователь с таким email уже существует.'
          : 'Не удалось создать учётную запись директора.',
    };
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    user_id: created.user.id,
    company_id: company.id,
    role: 'DIRECTOR',
    name: input.directorName,
    email: input.email,
    phone: input.phone || null,
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    await supabase.from('companies').delete().eq('id', company.id);
    return { error: 'Не удалось привязать директора к компании.' };
  }

  // Поток заявок по умолчанию. Без него адрес приёма, который компания видит
  // в «Интеграциях», был бы мёртвым: вебхук ищет ключ среди потоков, а не у
  // компании. Ключ берём тот же, что выдан компании, — он один и тот же адрес.
  if (company.lead_webhook_key) {
    await supabase.from('lead_sources').insert({
      company_id: company.id,
      name: 'Форма на сайте',
      platform: 'site',
      webhook_key: company.lead_webhook_key,
    });
  }

  await supabase.from('subscriptions').insert({
    company_id: company.id,
    plan: input.plan,
    status: 'active',
  });

  await logAction(admin.userId, company.id, 'company.created', 'company', company.id, {
    name: input.name,
    director_email: input.email,
  });

  revalidatePath('/admin');
  return { success: `Компания «${input.name}» создана. Директор может входить по своему email.` };
}

const updateCompanySchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(2, 'Укажите название компании').max(120),
  directorName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  status: z.enum(['active', 'trial', 'inactive']),
  funnelType: z.enum(['trial', 'direct']),
});

export async function updateCompany(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const admin = await requireSuperAdmin();
  if (!isAdminConfigured()) return { error: MISSING_KEY_ERROR };

  const parsed = updateCompanySchema.safeParse({
    companyId: formData.get('companyId'),
    name: formData.get('name'),
    directorName: formData.get('directorName'),
    phone: formData.get('phone'),
    status: formData.get('status'),
    funnelType: formData.get('funnelType'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from('companies')
    .update({
      name: parsed.data.name,
      director_name: parsed.data.directorName || null,
      phone: parsed.data.phone || null,
      status: parsed.data.status,
      funnel_type: parsed.data.funnelType,
    })
    .eq('id', parsed.data.companyId);

  if (error) return { error: 'Не удалось сохранить компанию.' };

  await logAction(
    admin.userId,
    parsed.data.companyId,
    'company.updated',
    'company',
    parsed.data.companyId,
    { status: parsed.data.status },
  );

  revalidatePath('/admin');
  revalidatePath(`/admin/companies/${parsed.data.companyId}`);
  return { success: 'Изменения сохранены.' };
}

/** Деактивация компании: доступ закрывается, данные сохраняются. */
export async function setCompanyStatus(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const admin = await requireSuperAdmin();
  if (!isAdminConfigured()) return { error: MISSING_KEY_ERROR };

  const parsed = z
    .object({
      companyId: z.string().uuid(),
      status: z.enum(['active', 'trial', 'inactive']),
    })
    .safeParse({
      companyId: formData.get('companyId'),
      status: formData.get('status'),
    });

  if (!parsed.success) {
    return { error: 'Некорректные данные запроса.' };
  }

  const { companyId, status } = parsed.data;

  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from('companies')
    .update({ status })
    .eq('id', companyId);

  if (error) return { error: 'Не удалось изменить статус.' };

  await logAction(admin.userId, companyId, 'company.status_changed', 'company', companyId, {
    status,
  });

  revalidatePath('/admin');
  revalidatePath(`/admin/companies/${companyId}`);
  return {
    success: status === 'inactive' ? 'Компания деактивирована.' : 'Компания активна.',
  };
}

const directorSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(2, 'Укажите имя').max(120),
  email: z.string().trim().toLowerCase().email('Некорректный email'),
  password: z.string().min(8, 'Пароль — минимум 8 символов').max(72),
});

/** Добавление ещё одного директора к существующей компании. */
export async function createDirector(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const admin = await requireSuperAdmin();
  if (!isAdminConfigured()) return { error: MISSING_KEY_ERROR };

  const parsed = directorSchema.safeParse({
    companyId: formData.get('companyId'),
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = createAdminSupabase();
  const { data: created, error: userError } = await supabase.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { name: parsed.data.name },
  });

  if (userError || !created.user) {
    return {
      error: userError?.message.includes('already')
        ? 'Пользователь с таким email уже существует.'
        : 'Не удалось создать учётную запись.',
    };
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    user_id: created.user.id,
    company_id: parsed.data.companyId,
    role: 'DIRECTOR',
    name: parsed.data.name,
    email: parsed.data.email,
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    return { error: 'Не удалось привязать директора к компании.' };
  }

  await logAction(
    admin.userId,
    parsed.data.companyId,
    'director.created',
    'profile',
    null,
    { email: parsed.data.email },
  );

  revalidatePath(`/admin/companies/${parsed.data.companyId}`);
  return { success: 'Директор добавлен и может входить в кабинет.' };
}

/** Рекламный кабинет Meta, доступный токену платформы. */
export type MetaAccountOption = {
  accountId: string;
  name: string;
  currency: string | null;
  /** Название компании, к которой кабинет уже подключён, если он занят. */
  takenBy: string | null;
};

/**
 * Какие рекламные кабинеты видит токен платформы.
 *
 * Список берём у самой Meta, а не просим вводить номер руками: ошибиться в
 * шестнадцати цифрах легко, а найти потом причину пустого отчёта — трудно.
 */
export async function listMetaAccounts(): Promise<{
  accounts: MetaAccountOption[];
  error?: string;
}> {
  await requireSuperAdmin();

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return { accounts: [], error: 'Не задан META_ACCESS_TOKEN в переменных окружения.' };
  }

  const version = process.env.META_API_VERSION || 'v23.0';
  const response = await fetch(
    `https://graph.facebook.com/${version}/me/adaccounts` +
      `?fields=name,currency,account_id&limit=200&access_token=${token}`,
    { cache: 'no-store' },
  );

  const payload = (await response.json()) as {
    data?: { name?: string; currency?: string; account_id?: string }[];
    error?: { message: string };
  };

  if (payload.error) return { accounts: [], error: `Meta API: ${payload.error.message}` };

  const supabase = createAdminSupabase();
  const { data: attached } = await supabase
    .from('ad_accounts')
    .select('account_id, companies(name)')
    .eq('platform', 'meta');

  const takenBy = new Map(
    (attached ?? []).map((row) => [
      row.account_id,
      (row as unknown as { companies?: { name?: string } }).companies?.name ?? 'другая компания',
    ]),
  );

  const accounts = (payload.data ?? [])
    .filter((item): item is { name?: string; currency?: string; account_id: string } =>
      Boolean(item.account_id),
    )
    .map((item) => ({
      accountId: item.account_id,
      name: item.name || `act_${item.account_id}`,
      currency: item.currency ?? null,
      takenBy: takenBy.get(item.account_id) ?? null,
    }));

  return { accounts };
}

const attachSchema = z.object({
  companyId: z.string().uuid(),
  accountId: z.string().regex(/^\d{5,20}$/, 'Некорректный номер рекламного кабинета'),
  accountName: z.string().trim().min(1).max(160),
});

/**
 * Проверка кабинета, введённого руками.
 *
 * Кабинет, выданный через партнёрский доступ, не всегда виден в списке
 * собственных, но читается по прямому номеру. Поэтому пробуем прочитать его и
 * возвращаем ответ Meta как есть: «нет доступа» и «такого кабинета нет» — это
 * разные беды с разным лечением.
 */
async function verifyMetaAccount(
  accountId: string,
): Promise<{ name: string; currency: string | null } | { error: string }> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { error: 'Не задан META_ACCESS_TOKEN в переменных окружения.' };

  const version = process.env.META_API_VERSION || 'v23.0';
  const response = await fetch(
    `https://graph.facebook.com/${version}/act_${accountId}` +
      `?fields=name,currency&access_token=${token}`,
    { cache: 'no-store' },
  );

  const payload = (await response.json()) as {
    name?: string;
    currency?: string;
    error?: { message: string; code: number };
  };

  if (payload.error) {
    const hint =
      payload.error.code === 100 || payload.error.code === 200
        ? ' Выдайте этот кабинет системному пользователю «Lidera» в Business Manager ' +
          '(Настройки компании → Пользователи → Системные пользователи → Добавить активы → ' +
          'Рекламные аккаунты → «Просмотр эффективности»).'
        : '';
    return { error: `Meta: ${payload.error.message}.${hint}` };
  }

  return { name: payload.name || `act_${accountId}`, currency: payload.currency ?? null };
}

/**
 * Подключение рекламного кабинета к компании и первая синхронизация.
 *
 * Синхронизируем сразу: владелец должен увидеть цифры в ту же минуту, а не
 * гадать до ночи, правильный ли кабинет он выбрал.
 */
export async function attachMetaAccount(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const admin = await requireSuperAdmin();

  // Номер можно выбрать из списка или ввести руками: кабинет, полученный по
  // партнёрскому доступу, в списке своих не появляется, но читается по номеру.
  const manual = String(formData.get('manualId') ?? '')
    .trim()
    .replace(/^act_/i, '');

  let accountName = String(formData.get('accountName') ?? '');

  if (manual) {
    const verified = await verifyMetaAccount(manual);
    if ('error' in verified) return { error: verified.error };
    accountName = verified.name;
  }

  const parsed = attachSchema.safeParse({
    companyId: formData.get('companyId'),
    accountId: manual || formData.get('accountId'),
    accountName,
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = createAdminSupabase();

  // Один кабинет — одна компания: иначе расход задвоится в двух отчётах.
  const { data: busy } = await supabase
    .from('ad_accounts')
    .select('company_id')
    .eq('platform', 'meta')
    .eq('account_id', parsed.data.accountId)
    .maybeSingle();

  if (busy && busy.company_id !== parsed.data.companyId) {
    return { error: 'Этот рекламный кабинет уже подключён к другой компании.' };
  }

  const { data: saved, error } = await supabase
    .from('ad_accounts')
    .upsert(
      {
        company_id: parsed.data.companyId,
        platform: 'meta',
        account_id: parsed.data.accountId,
        account_name: parsed.data.accountName,
        status: 'disconnected',
      },
      { onConflict: 'company_id,platform,account_id' },
    )
    .select('id')
    .maybeSingle();

  if (error || !saved) return { error: 'Не удалось сохранить рекламный кабинет.' };

  await logAction(
    admin.userId,
    parsed.data.companyId,
    'ad_account.attached',
    'ad_account',
    saved.id,
    { account_id: parsed.data.accountId, name: parsed.data.accountName },
  );

  revalidatePath(`/admin/companies/${parsed.data.companyId}`);

  try {
    const result = await syncMetaAccount(saved.id);
    return {
      success:
        `Кабинет «${result.account}» подключён: ${result.campaigns} кампаний, ` +
        `${result.days} дней данных, расход ${result.spend}.`,
    };
  } catch (syncError) {
    return {
      error:
        'Кабинет сохранён, но данные не загрузились: ' +
        (syncError instanceof Error ? syncError.message : 'неизвестная ошибка'),
    };
  }
}

/** Отключение рекламного кабинета: строки метрик остаются, новые не приходят. */
export async function detachMetaAccount(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const admin = await requireSuperAdmin();

  const parsed = z
    .object({ companyId: z.string().uuid(), adAccountRowId: z.string().uuid() })
    .safeParse({
      companyId: formData.get('companyId'),
      adAccountRowId: formData.get('adAccountRowId'),
    });

  if (!parsed.success) return { error: 'Некорректный запрос.' };

  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from('ad_accounts')
    .delete()
    .eq('id', parsed.data.adAccountRowId)
    .eq('company_id', parsed.data.companyId);

  if (error) return { error: 'Не удалось отключить кабинет.' };

  await logAction(
    admin.userId,
    parsed.data.companyId,
    'ad_account.detached',
    'ad_account',
    parsed.data.adAccountRowId,
    {},
  );

  revalidatePath(`/admin/companies/${parsed.data.companyId}`);
  return { success: 'Кабинет отключён. Уже загруженные цифры остались в отчётах.' };
}

const capiSchema = z.object({
  companyId: z.string().uuid(),
  datasetId: z.string().trim().regex(/^\d{5,25}$/, 'Номер набора данных — только цифры'),
  token: z.string().trim().min(20, 'Токен слишком короткий').max(500),
  testEventCode: z.string().trim().max(40).optional(),
});

/**
 * Настройка отправки покупок в Meta.
 *
 * Токен вводится один раз и в базу попадает зашифрованным: обратно его не
 * показывает ни один экран, при замене вводится заново.
 */
export async function saveCapiSettings(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const admin = await requireSuperAdmin();

  const parsed = capiSchema.safeParse({
    companyId: formData.get('companyId'),
    datasetId: formData.get('datasetId'),
    token: formData.get('token'),
    testEventCode: formData.get('testEventCode') || undefined,
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let encrypted: string;
  try {
    encrypted = encryptSecret(parsed.data.token);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Не удалось зашифровать токен.' };
  }

  const supabase = createAdminSupabase();
  const { error } = await supabase.from('capi_settings').upsert(
    {
      company_id: parsed.data.companyId,
      dataset_id: parsed.data.datasetId,
      token_encrypted: encrypted,
      test_event_code: parsed.data.testEventCode ?? null,
      enabled: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' },
  );

  if (error) return { error: 'Не удалось сохранить настройки.' };

  // В журнал пишем факт, но не сам токен — журнал читают люди.
  await logAction(admin.userId, parsed.data.companyId, 'capi.configured', 'company', null, {
    dataset_id: parsed.data.datasetId,
    token: secretHint(parsed.data.token),
  });

  revalidatePath(`/admin/companies/${parsed.data.companyId}`);
  return { success: 'Отправка покупок настроена. Проверьте её тестовым событием.' };
}

/** Пробное событие: проверяет токен и набор данных, не дожидаясь реальной продажи. */
export async function sendTestPurchase(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  await requireSuperAdmin();

  const companyId = z.string().uuid().safeParse(formData.get('companyId'));
  if (!companyId.success) return { error: 'Некорректный запрос.' };

  const result = await sendPurchase(companyId.data, {
    saleId: `test-${Date.now()}`,
    value: 1,
    currency: 'KZT',
    eventTime: new Date(),
    phone: '+77000000000',
    email: 'test@lidera.kz',
    name: 'Тест',
    fbc: null,
    fbp: null,
  });

  revalidatePath(`/admin/companies/${companyId.data}`);

  return result.ok
    ? {
        success:
          'Тестовое событие отправлено. Проверьте его в Events Manager → «Тестирование событий».',
      }
    : { error: `Meta не приняла событие: ${result.error}` };
}

/**
 * Открыть кабинет компании для наблюдения.
 *
 * Это не вход под чужой учётной записью: сессия остаётся администраторской,
 * данные читаются под RLS, а любые изменения в кабинете заблокированы. Факт
 * просмотра пишем в журнал — владелец компании вправе его увидеть.
 */
export async function observeCompany(companyId: string): Promise<void> {
  const admin = await requireSuperAdmin();

  const parsed = z.string().uuid().safeParse(companyId);
  if (!parsed.success) redirect('/admin');

  await logAction(admin.userId, parsed.data, 'company.observed', 'company', parsed.data, {});

  (await cookies()).set(VIEW_COMPANY_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: OBSERVE_SESSION_SECONDS,
  });

  redirect('/dashboard');
}

/** Выйти из режима наблюдения и вернуться в админ-панель. */
export async function stopObserving(): Promise<void> {
  await requireSuperAdmin();
  (await cookies()).delete(VIEW_COMPANY_COOKIE);
  redirect('/admin');
}

async function logAction(
  userId: string,
  companyId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  const supabase = createAdminSupabase();
  await supabase.from('audit_logs').insert({
    company_id: companyId,
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata: metadata as never,
  });
}
