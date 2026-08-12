'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireSuperAdmin } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export type AdminState = { error?: string; success?: string };

const createCompanySchema = z.object({
  name: z.string().trim().min(2, 'Укажите название компании').max(120),
  directorName: z.string().trim().min(2, 'Укажите имя директора').max(120),
  email: z.string().trim().toLowerCase().email('Некорректный email директора'),
  phone: z.string().trim().max(40).optional(),
  password: z.string().min(8, 'Временный пароль — минимум 8 символов').max(72),
  status: z.enum(['active', 'trial', 'inactive']),
  plan: z.enum(['trial', 'start', 'pro', 'enterprise']),
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

  const parsed = createCompanySchema.safeParse({
    name: formData.get('name'),
    directorName: formData.get('directorName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    password: formData.get('password'),
    status: formData.get('status'),
    plan: formData.get('plan'),
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
    })
    .select('id')
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
});

export async function updateCompany(
  _prevState: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const admin = await requireSuperAdmin();

  const parsed = updateCompanySchema.safeParse({
    companyId: formData.get('companyId'),
    name: formData.get('name'),
    directorName: formData.get('directorName'),
    phone: formData.get('phone'),
    status: formData.get('status'),
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
