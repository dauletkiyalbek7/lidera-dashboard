import { NextResponse } from 'next/server';

import { LEAD_STATUS, isLeadStatus, type LeadStatus } from '@/lib/lead-status';
import { resolveShiftRules, type ShiftRules } from '@/lib/attendance';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { runDistribution } from '@/lib/lead-distribution';
import { createAdminSupabase, isAdminConfigured } from '@/lib/supabase/admin';
import { leadCard, statusButtons, escapeHtml } from '@/lib/telegram-lead-card';
import {
  answerCallback,
  isBotConfigured,
  sendMessage,
  webhookSecret,
  type KeyboardButton,
} from '@/lib/telegram';

/**
 * Рабочее место сотрудника — Telegram-бот.
 *
 * Вход в кабинет сотруднику не выдаётся, поэтому у бота нет пользовательской
 * сессии: он ходит в базу сервисным ключом, в обход RLS. Значит компанию и
 * права определяем сами — по telegram_user_id из карточки сотрудника, и в
 * каждом запросе к данным явно фильтруем по его company_id.
 *
 * Вебхук всегда отвечает 200: на любой другой код Telegram повторяет
 * доставку того же обновления, и ошибка превращается в бесконечный цикл.
 */

export const dynamic = 'force-dynamic';

const KEYBOARD_OFF = [['🟢 Я на смене'], ['📋 Мои лиды']];
const KEYBOARD_ON = [['🔴 Я ухожу'], ['📋 Мои лиды']];
/** Геолокацию Telegram отдаёт только по нажатию этой кнопки — не автоматически. */
const KEYBOARD_GEO: KeyboardButton[][] = [
  [{ text: '📍 Отправить геолокацию', request_location: true }],
  ['↩️ Отмена'],
];

export async function POST(request: Request) {
  if (!isBotConfigured() || !isAdminConfigured()) {
    console.error('telegram webhook: бот или сервисный ключ не настроены');
    return NextResponse.json({ ok: true });
  }

  const secret = webhookSecret();
  if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    // Чужой запрос: адрес вебхука публичный, отличить Telegram можно только по секрету.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (error) {
    console.error('telegram webhook', error);
  }

  return NextResponse.json({ ok: true });
}

// -----------------------------------------------------------------------------
// Сообщения
// -----------------------------------------------------------------------------

async function handleMessage(message: TelegramMessage) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = (message.text ?? '').trim();
  if (!userId) return;

  if (message.location) {
    const employee = await findEmployee(userId);
    if (!employee) return;
    return openShiftWithLocation(chatId, employee, message.location);
  }

  if (text.startsWith('/start')) {
    const token = text.slice('/start'.length).trim();
    if (token) return bindEmployee(chatId, userId, message.from?.username ?? null, token);
  }

  const employee = await findEmployee(userId);
  if (!employee) {
    return sendMessage(
      chatId,
      'Вы пока не подключены. Попросите у директора ссылку-приглашение и откройте её — она привяжет этот аккаунт к вашей карточке.',
    );
  }

  if (text.includes('Отмена')) {
    return sendMessage(chatId, 'Хорошо, смену не открываем.', { keyboard: KEYBOARD_OFF });
  }
  if (text.includes('на смене')) return startShiftFlow(chatId, employee);
  if (text.includes('ухожу')) return closeShift(chatId, employee);
  if (text.includes('Мои лиды')) return listLeads(chatId, employee);

  const open = await openShiftOf(employee.id);
  return sendMessage(
    chatId,
    `Привет, ${escapeHtml(employee.full_name)}!\nВыберите действие на клавиатуре ниже.`,
    { keyboard: open ? KEYBOARD_ON : KEYBOARD_OFF },
  );
}

/** Привязка аккаунта по одноразовой ссылке. */
async function bindEmployee(
  chatId: number,
  userId: number,
  username: string | null,
  token: string,
) {
  const supabase = createAdminSupabase();

  const { data: invite } = await supabase
    .from('employee_invites')
    .select('id, employee_id, company_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (!invite || invite.used_at) {
    return sendMessage(chatId, 'Ссылка уже использована. Попросите у директора новую.');
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return sendMessage(chatId, 'Срок действия ссылки истёк. Попросите у директора новую.');
  }

  const { data: employee } = await supabase
    .from('employees')
    .select('id, full_name, status')
    .eq('id', invite.employee_id)
    .maybeSingle();

  if (!employee || employee.status !== 'active') {
    return sendMessage(chatId, 'Карточка сотрудника недоступна. Обратитесь к директору.');
  }

  const { error } = await supabase
    .from('employees')
    .update({ telegram_user_id: userId, telegram_username: username })
    .eq('id', employee.id);

  if (error) {
    // Единственный реальный случай — этот Telegram уже привязан к другой карточке.
    return sendMessage(
      chatId,
      'Этот Telegram уже привязан к другому сотруднику. Обратитесь к директору.',
    );
  }

  await supabase
    .from('employee_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id);

  return sendMessage(
    chatId,
    `Готово, ${escapeHtml(employee.full_name)}. Аккаунт привязан.\n\nНачинайте рабочий день кнопкой «Я на смене» — лиды будут приходить сюда.`,
    { keyboard: KEYBOARD_OFF },
  );
}

// -----------------------------------------------------------------------------
// Смены
// -----------------------------------------------------------------------------

/**
 * Открытие смены. В режиме geo сначала просим геолокацию: Telegram отдаёт её
 * только по нажатию кнопки, тихо определить место сотрудника нельзя — и это
 * правильно, человек должен видеть, что делится координатами.
 */
async function startShiftFlow(chatId: number, employee: Employee) {
  const company = await companyOf(employee.company_id);
  const rules = company ? resolveShiftRules(employee, company) : null;

  if (rules?.mode === 'always') {
    return sendMessage(
      chatId,
      'В вашей компании смену открывать не нужно — лиды приходят всегда.',
      { keyboard: [['📋 Мои лиды']] },
    );
  }

  if (await openShiftOf(employee.id)) {
    return sendMessage(chatId, 'Смена уже открыта.', { keyboard: KEYBOARD_ON });
  }

  const needsLocation =
    rules?.mode === 'geo' &&
    company !== null &&
    company.office_lat !== null &&
    company.office_lng !== null;

  if (needsLocation) {
    return sendMessage(
      chatId,
      'Чтобы открыть смену, отправьте геолокацию — проверим, что вы на месте.',
      { keyboard: KEYBOARD_GEO },
    );
  }

  return openShift(chatId, employee, null);
}

/** Пришли координаты: считаем расстояние до офиса и решаем. */
async function openShiftWithLocation(
  chatId: number,
  employee: Employee,
  location: { latitude: number; longitude: number },
) {
  const company = await companyOf(employee.company_id);

  // Личный режим «по кнопке» отменяет проверку места, даже если компания в geo.
  if (company && resolveShiftRules(employee, company).mode !== 'geo') {
    return openShift(chatId, employee, null);
  }

  if (!company || company.office_lat === null || company.office_lng === null) {
    return openShift(chatId, employee, null);
  }

  const distance = distanceMeters(
    { lat: location.latitude, lng: location.longitude },
    { lat: Number(company.office_lat), lng: Number(company.office_lng) },
  );

  if (distance > company.office_radius_m) {
    return sendMessage(
      chatId,
      `Вы <b>${formatDistance(distance)}</b> от офиса — это дальше допустимых ${formatDistance(company.office_radius_m)}.\n\nОткрыть смену можно на месте. Если работаете удалённо, попросите директора изменить режим смены.`,
      { keyboard: KEYBOARD_OFF },
    );
  }

  return openShift(chatId, employee, {
    lat: location.latitude,
    lng: location.longitude,
    distance,
  });
}

async function openShift(
  chatId: number,
  employee: Employee,
  place: { lat: number; lng: number; distance: number } | null,
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);
  const late = company ? isLate(company, resolveShiftRules(employee, company)) : false;

  const { error } = await supabase.from('shifts').insert({
    company_id: employee.company_id,
    employee_id: employee.id,
    source: 'telegram',
    start_lat: place?.lat ?? null,
    start_lng: place?.lng ?? null,
    start_distance_m: place?.distance ?? null,
    late,
  });

  if (error) return sendMessage(chatId, 'Не удалось открыть смену, попробуйте ещё раз.');

  await markAttendance(employee, late ? 'late' : 'on_shift');

  // Пока сотрудник был не на смене, лиды могли копиться в очереди.
  await runDistribution(employee.company_id);

  const active = await countActiveLeads(employee.id);
  const lines = [
    late ? '⏰ Смена открыта с опозданием.' : 'Смена открыта. Хорошей работы!',
    place ? `Вы в ${formatDistance(place.distance)} от офиса.` : null,
    '',
    `В работе сейчас: <b>${active}</b> ${plural(active, 'лид', 'лида', 'лидов')}.`,
  ];

  return sendMessage(chatId, lines.filter((line) => line !== null).join('\n'), {
    keyboard: KEYBOARD_ON,
  });
}

/** Отметка в табеле. Ставится автоматически и не затирает ручную. */
async function markAttendance(employee: Employee, status: 'on_shift' | 'late') {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);
  const today = localDate(company?.timezone ?? 'Asia/Almaty');

  const { data: existing } = await supabase
    .from('attendance')
    .select('id, source')
    .eq('employee_id', employee.id)
    .eq('date', today)
    .maybeSingle();

  // Больничный или отпуск, проставленный директором, важнее автоматической отметки.
  if (existing && existing.source === 'manual') return;

  if (existing) {
    await supabase.from('attendance').update({ status }).eq('id', existing.id);
    return;
  }

  await supabase.from('attendance').insert({
    company_id: employee.company_id,
    employee_id: employee.id,
    date: today,
    status,
    source: 'auto',
  });
}

/**
 * Опоздание — по местному времени компании и по личному графику сотрудника:
 * у удалёнщика рабочий день может начинаться позже, чем в офисе.
 */
function isLate(company: CompanyRow, rules: ShiftRules): boolean {
  const now = new Date();
  const local = new Intl.DateTimeFormat('ru-RU', {
    timeZone: company.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  const [hours, minutes] = local.split(':').map(Number);
  const [startHours, startMinutes] = rules.workStartTime.split(':').map(Number);

  return hours * 60 + minutes > startHours * 60 + startMinutes + rules.lateGraceMinutes;
}

function localDate(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

type CompanyRow = {
  shift_mode: string;
  office_lat: number | null;
  office_lng: number | null;
  office_radius_m: number;
  timezone: string;
  work_start_time: string;
  late_grace_minutes: number;
  funnel_type: string;
};

async function companyOf(companyId: string): Promise<CompanyRow | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('companies')
    .select(
      'shift_mode, office_lat, office_lng, office_radius_m, timezone, work_start_time, late_grace_minutes, funnel_type',
    )
    .eq('id', companyId)
    .maybeSingle();
  return data ?? null;
}

async function closeShift(chatId: number, employee: Employee) {
  const supabase = createAdminSupabase();
  const shift = await openShiftOf(employee.id);

  if (!shift) return sendMessage(chatId, 'Смена не открыта.', { keyboard: KEYBOARD_OFF });

  const endedAt = new Date();
  await supabase
    .from('shifts')
    .update({ ended_at: endedAt.toISOString() })
    .eq('id', shift.id);

  const minutes = Math.max(
    1,
    Math.round((endedAt.getTime() - new Date(shift.started_at).getTime()) / 60000),
  );
  const hours = Math.floor(minutes / 60);

  return sendMessage(
    chatId,
    `Смена закрыта. Отработано: <b>${hours ? `${hours} ч ` : ''}${minutes % 60} мин</b>.`,
    { keyboard: KEYBOARD_OFF },
  );
}

// -----------------------------------------------------------------------------
// Лиды
// -----------------------------------------------------------------------------

const ACTIVE_STATUSES: LeadStatus[] = [
  'new',
  'no_answer',
  'contacted',
  'in_progress',
  'thinking',
];

async function listLeads(chatId: number, employee: Employee) {
  const supabase = createAdminSupabase();

  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, source, platform, status')
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!leads || leads.length === 0) {
    return sendMessage(chatId, 'Активных лидов нет. Как появятся — пришлю сюда.');
  }

  const { data: company } = await supabase
    .from('companies')
    .select('funnel_type')
    .eq('id', employee.company_id)
    .maybeSingle();

  const funnelType = company?.funnel_type === 'direct' ? 'direct' : 'trial';

  for (const lead of leads) {
    await sendMessage(chatId, leadCard(lead), { inline: statusButtons(lead.id, funnelType) });
  }
}


async function handleCallback(query: TelegramCallbackQuery) {
  const userId = query.from?.id;
  const chatId = query.message?.chat.id;
  if (!userId || !chatId) return;

  const employee = await findEmployee(userId);
  if (!employee) return answerCallback(query.id, 'Вы не подключены к платформе.');

  const [kind, leadId, status] = (query.data ?? '').split(':');
  if (kind !== 's' || !leadId || !status) return answerCallback(query.id);

  if (!isLeadStatus(status)) return answerCallback(query.id, 'Неизвестный статус.');

  const supabase = createAdminSupabase();

  // Сотрудник двигает только свои лиды и только внутри своей компании.
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name')
    .eq('id', leadId)
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id)
    .maybeSingle();

  if (!lead) return answerCallback(query.id, 'Этот лид уже не за вами.');

  const { error } = await supabase
    .from('leads')
    .update({ status: status as LeadStatus })
    .eq('id', lead.id)
    .eq('company_id', employee.company_id);

  if (error) return answerCallback(query.id, 'Не удалось сохранить статус.');

  const label = LEAD_STATUS[status].label;
  await answerCallback(query.id, `Статус: ${label}`);
  return sendMessage(chatId, `✅ <b>${escapeHtml(lead.name || 'Лид')}</b> → ${label}`);
}

// -----------------------------------------------------------------------------
// Общее
// -----------------------------------------------------------------------------

type Employee = {
  id: string;
  company_id: string;
  full_name: string;
  role: string;
  shift_mode: string | null;
  work_start_time: string | null;
  late_grace_minutes: number | null;
};

async function findEmployee(telegramUserId: number): Promise<Employee | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('employees')
    .select(
      'id, company_id, full_name, role, shift_mode, work_start_time, late_grace_minutes',
    )
    .eq('telegram_user_id', telegramUserId)
    .eq('status', 'active')
    .maybeSingle();
  return data ?? null;
}

async function openShiftOf(employeeId: string) {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('shifts')
    .select('id, started_at')
    .eq('employee_id', employeeId)
    .is('ended_at', null)
    .maybeSingle();
  return data ?? null;
}

async function countActiveLeads(employeeId: string): Promise<number> {
  const supabase = createAdminSupabase();
  const { count } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', employeeId)
    .in('status', ACTIVE_STATUSES);
  return count ?? 0;
}


function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramMessage = {
  chat: { id: number };
  from?: { id: number; username?: string };
  text?: string;
  location?: { latitude: number; longitude: number };
};

type TelegramCallbackQuery = {
  id: string;
  from?: { id: number };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
};
