'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { SHIFT_MODE_ORDER, parseWorkDays } from '@/lib/attendance';
import { requireCompanySession, VIEW_ONLY_ERROR } from '@/lib/auth';
import { runDistribution } from '@/lib/lead-distribution';
import { EMPLOYEE_ROLE, EMPLOYEE_ROLE_ORDER } from '@/lib/employee-role';
import { createAdminSupabase, isAdminConfigured } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Сотрудники компании и назначение ответственного за лида.
 *
 * company_id всегда из сессии: кто может писать, решает RLS, а какой компании
 * принадлежит запись — сервер. Из формы приходят только данные человека.
 */

export type TeamState = { error?: string; success?: string };

const employeeSchema = z.object({
  fullName: z.string().trim().min(2, 'Укажите имя сотрудника').max(120),
  role: z.enum(EMPLOYEE_ROLE_ORDER),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value : null)),
});

export async function createEmployee(
  _prevState: TeamState,
  formData: FormData,
): Promise<TeamState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = employeeSchema.safeParse({
    fullName: formData.get('fullName'),
    role: formData.get('role'),
    phone: formData.get('phone'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Продажник существует только там, где есть пробные занятия.
  if (
    EMPLOYEE_ROLE[parsed.data.role].onlyTrialFunnel &&
    company.funnel_type !== 'trial'
  ) {
    return { error: 'Эта роль доступна только компаниям с пробными занятиями.' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('employees').insert({
    company_id: company.id,
    full_name: parsed.data.fullName,
    role: parsed.data.role,
    phone: parsed.data.phone,
  });

  if (error) return { error: 'Не удалось добавить сотрудника.' };

  revalidateTeam();
  return { success: 'Сотрудник добавлен.' };
}

/**
 * Увольнение мягкое: строка остаётся, лиды и продажи прошлых периодов
 * продолжают считаться за этим человеком. Открытые лиды освобождаются —
 * иначе они зависнут на том, кто уже не работает.
 */
export async function fireEmployee(employeeId: string): Promise<TeamState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = z.string().uuid().safeParse(employeeId);
  if (!parsed.success) return { error: 'Некорректный сотрудник.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('employees')
    .update({ status: 'fired', fired_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось уволить сотрудника.' };

  await supabase
    .from('leads')
    .update({ assigned_to: null, assigned_at: null })
    .eq('company_id', company.id)
    .eq('assigned_to', parsed.data)
    .in('status', ['new', 'no_answer', 'contacted', 'in_progress', 'thinking']);

  await supabase
    .from('lead_assignments')
    .update({ released_at: new Date().toISOString(), reason: 'fired' })
    .eq('employee_id', parsed.data)
    .eq('company_id', company.id)
    .is('released_at', null);

  // Освободившиеся лиды сразу уходят тем, кто на смене.
  await runDistribution(company.id);

  revalidateTeam();
  return { success: 'Сотрудник уволен, его активные лиды освобождены.' };
}

/** Возврат сотрудника — бывает и такое, повторно заводить карточку не нужно. */
export async function rehireEmployee(employeeId: string): Promise<TeamState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = z.string().uuid().safeParse(employeeId);
  if (!parsed.success) return { error: 'Некорректный сотрудник.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('employees')
    .update({ status: 'active', fired_at: null })
    .eq('id', parsed.data)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось вернуть сотрудника.' };

  revalidateTeam();
  return { success: 'Сотрудник снова активен.' };
}

/** Сколько живёт ссылка-приглашение. Дольше — выше риск, что её перешлют. */
const INVITE_TTL_HOURS = 48;

export type InviteState = { error?: string; link?: string; expiresAt?: string };

/**
 * Ссылка для входа сотрудника в бот: t.me/<бот>?start=<токен>.
 *
 * Токен случайный и одноразовый — бот пометит его использованным при первом
 * переходе. Прежние неиспользованные приглашения этого сотрудника гасим, иначе
 * старая ссылка из переписки останется рабочей.
 */
export async function createInvite(employeeId: string): Promise<InviteState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = z.string().uuid().safeParse(employeeId);
  if (!parsed.success) return { error: 'Некорректный сотрудник.' };

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!botUsername) return { error: 'Бот не настроен: не задано имя бота.' };

  const supabase = await createServerSupabase();

  const { data: employee } = await supabase
    .from('employees')
    .select('id, status')
    .eq('id', parsed.data)
    .eq('company_id', company.id)
    .maybeSingle();

  if (!employee) return { error: 'Сотрудник не найден.' };
  if (employee.status !== 'active') return { error: 'Сотрудник уволен.' };

  const now = new Date();
  await supabase
    .from('employee_invites')
    .update({ used_at: now.toISOString() })
    .eq('employee_id', parsed.data)
    .eq('company_id', company.id)
    .is('used_at', null);

  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);

  const { error } = await supabase.from('employee_invites').insert({
    company_id: company.id,
    employee_id: parsed.data,
    token,
    expires_at: expiresAt.toISOString(),
  });

  if (error) return { error: 'Не удалось создать приглашение.' };

  revalidateTeam();
  return {
    link: `https://t.me/${botUsername}?start=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** 32 символа из криптографического источника — угадать перебором нереально. */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Назначить ответственного за лида. Пустая строка снимает ответственного. */
export async function assignLead(
  leadId: string,
  employeeId: string,
): Promise<TeamState> {
  const { company, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  const parsed = z
    .object({
      leadId: z.string().uuid(),
      employeeId: z.string().uuid().or(z.literal('')),
    })
    .safeParse({ leadId, employeeId });

  if (!parsed.success) return { error: 'Некорректные данные.' };

  const supabase = await createServerSupabase();

  // Сотрудник должен быть из этой же компании и не уволен. RLS не отличает
  // «чужого сотрудника» от «своего», поэтому проверяем явно.
  if (parsed.data.employeeId) {
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('id', parsed.data.employeeId)
      .eq('company_id', company.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!employee) return { error: 'Сотрудник не найден или уже уволен.' };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('leads')
    .update({
      assigned_to: parsed.data.employeeId || null,
      assigned_at: parsed.data.employeeId ? now : null,
    })
    .eq('id', parsed.data.leadId)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось назначить ответственного.' };

  // Журнал: закрываем прежнее назначение и открываем новое. Без него нельзя
  // ни разобрать спор «мне лид не приходил», ни считать честную очередь.
  await supabase
    .from('lead_assignments')
    .update({ released_at: now, reason: 'manual' })
    .eq('lead_id', parsed.data.leadId)
    .eq('company_id', company.id)
    .is('released_at', null);

  if (parsed.data.employeeId) {
    await supabase.from('lead_assignments').insert({
      company_id: company.id,
      lead_id: parsed.data.leadId,
      employee_id: parsed.data.employeeId,
      assigned_at: now,
      reason: 'manual',
    });
  }

  revalidateTeam();
  return { success: 'Ответственный назначен.' };
}

function revalidateTeam() {
  revalidatePath('/dashboard', 'layout');
}

const scheduleSchema = z.object({
  employeeId: z.string().uuid(),
  /** Пустая строка означает «как в компании» — это осознанный выбор, а не ошибка. */
  shiftMode: z.enum(['', ...SHIFT_MODE_ORDER]),
  /** inherit — график компании, custom — личный. */
  scheduleMode: z.enum(['inherit', 'custom']),
});

const customScheduleSchema = z.object({
  workStartTime: z.string().regex(/^\d{2}:\d{2}$/, 'Укажите начало дня в формате 09:00'),
  workEndTime: z.string().regex(/^\d{2}:\d{2}$/, 'Укажите конец дня в формате 18:00'),
  lateGraceMinutes: z.coerce.number().int().min(0).max(120, 'Допуск — не больше 120 минут'),
});

/**
 * Личные правила сотрудника: режим смены и график.
 *
 * «Как в компании» пишет NULL — так директор меняет общее правило один раз, и
 * оно доходит до всех, у кого нет исключения. Режим и график независимы:
 * удалёнщик может отмечаться без геолокации, но работать по общим часам.
 */
export async function updateEmployeeSchedule(
  _prevState: TeamState,
  formData: FormData,
): Promise<TeamState> {
  const { company, profile, readOnly } = await requireCompanySession();

  if (readOnly) return { error: VIEW_ONLY_ERROR };

  if (profile.role !== 'DIRECTOR') {
    return { error: 'Менять график сотрудников может только директор.' };
  }

  const parsed = scheduleSchema.safeParse({
    employeeId: formData.get('employeeId'),
    shiftMode: formData.get('shiftMode') ?? '',
    scheduleMode: formData.get('scheduleMode') ?? 'inherit',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  if (parsed.data.shiftMode === 'geo' && company.office_lat === null) {
    return { error: 'Сначала укажите координаты офиса в настройках компании.' };
  }

  let schedule = {
    work_start_time: null as string | null,
    work_end_time: null as string | null,
    work_days: null as number[] | null,
    late_grace_minutes: null as number | null,
  };

  if (parsed.data.scheduleMode === 'custom') {
    const custom = customScheduleSchema.safeParse({
      workStartTime: formData.get('workStartTime'),
      workEndTime: formData.get('workEndTime'),
      lateGraceMinutes: formData.get('lateGraceMinutes'),
    });

    if (!custom.success) return { error: custom.error.issues[0].message };

    const workDays = parseWorkDays(formData.getAll('workDays').map(String));
    if (!workDays) return { error: 'Выберите хотя бы один рабочий день.' };

    if (custom.data.workStartTime === custom.data.workEndTime) {
      return { error: 'Начало и конец рабочего дня совпадают.' };
    }

    schedule = {
      work_start_time: custom.data.workStartTime,
      work_end_time: custom.data.workEndTime,
      work_days: workDays,
      late_grace_minutes: custom.data.lateGraceMinutes,
    };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('employees')
    .update({ shift_mode: parsed.data.shiftMode || null, ...schedule })
    .eq('id', parsed.data.employeeId)
    .eq('company_id', company.id);

  if (error) return { error: 'Не удалось сохранить график.' };

  // Режим мог смениться на «без смены» — тогда человек уже может получать лиды.
  await runDistribution(company.id);

  revalidateTeam();
  return { success: 'График сохранён.' };
}

// -----------------------------------------------------------------------------
// Вход в кабинет
// -----------------------------------------------------------------------------

const loginSchema = z.object({
  employeeId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('Проверьте адрес почты'),
  password: z
    .string()
    .min(10, 'Пароль короче 10 знаков подобрать слишком легко')
    .max(72, 'Пароль длиннее 72 знаков Supabase не принимает'),
});

export type LoginState = { error?: string; success?: string };

/**
 * Выдать сотруднику вход в кабинет.
 *
 * Пароль задаёт директор и передаёт лично: почтового ящика у менеджера может
 * не быть вовсе, а письмо-приглашение до него тогда не дойдёт. Адрес нужен
 * только как логин и для восстановления пароля.
 *
 * Что сотрудник увидит внутри, решает не интерфейс, а политики базы:
 * менеджеру видны лиды, где он ответственный, продажнику — его уроки.
 */
export async function createEmployeeLogin(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const { company, readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };
  if (!isAdminConfigured()) {
    return { error: 'Не настроен сервисный ключ — учётные записи создать нельзя.' };
  }

  const parsed = loginSchema.safeParse({
    employeeId: formData.get('employeeId'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createServerSupabase();
  const { data: employee } = await supabase
    .from('employees')
    .select('id, full_name, status, profile_id')
    .eq('id', parsed.data.employeeId)
    .eq('company_id', company.id)
    .maybeSingle();

  if (!employee) return { error: 'Сотрудник не найден.' };
  if (employee.status !== 'active') return { error: 'Сотрудник уволен.' };
  if (employee.profile_id) return { error: 'У этого сотрудника вход уже есть.' };

  const admin = createAdminSupabase();
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { name: employee.full_name },
  });

  if (userError || !created.user) {
    return {
      error: userError?.message.includes('already')
        ? 'Учётная запись с такой почтой уже есть.'
        : 'Не удалось создать учётную запись.',
    };
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({
      user_id: created.user.id,
      company_id: company.id,
      role: 'EMPLOYEE',
      name: employee.full_name,
      email: parsed.data.email,
    })
    .select('id')
    .maybeSingle();

  // Учётная запись без профиля бесполезна и мешает завести её заново —
  // откатываем, чтобы не оставлять мусор в auth.
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: 'Не удалось привязать учётную запись к сотруднику.' };
  }

  const { error: linkError } = await admin
    .from('employees')
    .update({ profile_id: profile.id })
    .eq('id', employee.id);

  if (linkError) {
    await admin.from('profiles').delete().eq('id', profile.id);
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: 'Не удалось связать карточку сотрудника с учётной записью.' };
  }

  revalidateTeam();
  return {
    success: `Вход выдан. Логин: ${parsed.data.email}. Пароль передайте лично — на экране он больше не появится.`,
  };
}

/** Закрыть сотруднику вход, не трогая его карточку и историю. */
export async function revokeEmployeeLogin(employeeId: string): Promise<LoginState> {
  const { company, readOnly } = await requireCompanySession();
  if (readOnly) return { error: VIEW_ONLY_ERROR };
  if (!isAdminConfigured()) return { error: 'Не настроен сервисный ключ.' };

  const parsed = z.string().uuid().safeParse(employeeId);
  if (!parsed.success) return { error: 'Некорректный сотрудник.' };

  const supabase = await createServerSupabase();
  const { data: employee } = await supabase
    .from('employees')
    .select('id, profile_id')
    .eq('id', parsed.data)
    .eq('company_id', company.id)
    .maybeSingle();

  if (!employee?.profile_id) return { error: 'У этого сотрудника входа нет.' };

  const admin = createAdminSupabase();
  const { data: profile } = await admin
    .from('profiles')
    .select('user_id')
    .eq('id', employee.profile_id)
    .maybeSingle();

  await admin.from('employees').update({ profile_id: null }).eq('id', employee.id);
  await admin.from('profiles').delete().eq('id', employee.profile_id);
  if (profile?.user_id) await admin.auth.admin.deleteUser(profile.user_id);

  revalidateTeam();
  return { success: 'Вход закрыт. Карточка и история сотрудника сохранены.' };
}
