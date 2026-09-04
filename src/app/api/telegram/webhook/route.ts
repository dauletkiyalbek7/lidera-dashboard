import { NextResponse } from 'next/server';

import {
  isLeadStatus,
  leadStatusFor,
  leadStatusesFor,
  type LeadStatus,
} from '@/lib/lead-status';
import { TRIAL_STATUS, isTrialStatus } from '@/lib/trial-status';
import {
  formatSchedule,
  resolveShiftRules,
  weekdayInZone,
  type ShiftRules,
} from '@/lib/attendance';
import { createRateLookup } from '@/lib/currency';
import { zonedDayWindow } from '@/lib/period';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { parseSaleAmount } from '@/lib/sale-amount';
import { runDistribution } from '@/lib/lead-distribution';
import {
  instantInZone,
  isTouchPreset,
  resolveTouchTime,
  touchPreset,
  untilLabel,
} from '@/lib/lead-touches';
import { closeOpenTouches, scheduleTouch } from '@/lib/touch-runner';
import { employeeStats, statsMessage } from '@/lib/employee-stats';
import {
  formatTrialTime,
  sellerAvailability,
  notifyTrialBooked,
  shortCreativeLabel,
  syncTrialForLead,
} from '@/lib/trials';
import { LEAD_QUALITY, isLeadQuality, qualityBadge } from '@/lib/lead-quality';
import { createAdminSupabase, isAdminConfigured } from '@/lib/supabase/admin';
import {
  leadCard,
  statusButtons,
  trialOutcomeButtons,
  bookingDayButtons,
  bookingTimeButtons,
  bookingSellerButtons,
  qualityButtons,
  touchButtons,
  whatsappButton,
  STATUS_ICON,
  NO_ANSWER_TOUCHES,
  THINKING_TOUCHES,
  BOOKING_HOURS,
  escapeHtml,
} from '@/lib/telegram-lead-card';
import {
  answerCallback,
  isBotConfigured,
  sendMessage,
  webhookSecret,
  type InlineButton,
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

const KEYBOARD_OFF = [
  ['🟢 Я на смене'],
  ['📋 Мои лиды', '📵 Недозвон'],
  ['📊 Мои показатели'],
];
const KEYBOARD_ON = [
  ['🔴 Я ухожу'],
  ['📋 Мои лиды', '📵 Недозвон'],
  ['📊 Мои показатели'],
];

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
// Группы: отчёты по расписанию
// -----------------------------------------------------------------------------

/** Команда без имени бота: в группе Telegram дописывает «@lidera_bot». */
function commandOf(text: string): { name: string; argument: string } {
  const [head, ...rest] = text.split(/\s+/);
  return { name: head.split('@')[0].toLowerCase(), argument: rest.join(' ').trim() };
}

const BIND_COMMANDS = ['/отчёт', '/отчет', '/report'];
const UNBIND_COMMANDS = ['/отвязать', '/unbind'];

/**
 * Привязка группы к проекту.
 *
 * Бот видит все группы одинаково, поэтому проект называет человек — кодом из
 * настроек. Код короткий: его набирают руками в чате, а не копируют ссылкой.
 */
async function handleGroupCommand(message: TelegramMessage, text: string) {
  const chatId = message.chat.id;
  const { name, argument } = commandOf(text);

  if (UNBIND_COMMANDS.includes(name)) {
    const supabase = createAdminSupabase();
    await supabase.from('report_chats').delete().eq('chat_id', chatId);
    return sendMessage(
      chatId,
      'Отчёты в эту группу больше не приходят. Чтобы вернуть — снова отправьте команду с кодом проекта.',
    );
  }

  if (!BIND_COMMANDS.includes(name)) return;

  if (!argument) {
    return sendMessage(
      chatId,
      'Нужен код проекта: <code>/отчёт КОД</code>. Код лежит в кабинете, в «Настройках» проекта.',
    );
  }

  const supabase = createAdminSupabase();
  const code = argument.split(/\s+/)[0].toLowerCase();

  const { data: company } = await supabase
    .from('companies')
    .select('id, name')
    .eq('report_code', code)
    .maybeSingle();

  if (!company) {
    return sendMessage(
      chatId,
      'Такого кода нет. Проверьте его в кабинете: «Настройки» → «Отчёты в Telegram».',
    );
  }

  const who = message.from?.username
    ? `@${message.from.username}`
    : (message.from?.first_name ?? null);

  // Одна группа — один проект: повторная команда с другим кодом переносит
  // группу, а не заводит вторую привязку.
  const { error } = await supabase.from('report_chats').upsert(
    {
      company_id: company.id,
      chat_id: chatId,
      title: message.chat.title ?? null,
      linked_by: who,
    },
    { onConflict: 'chat_id' },
  );

  if (error) {
    console.error('telegram bind chat', error);
    return sendMessage(chatId, 'Не получилось привязать группу. Попробуйте ещё раз.');
  }

  return sendMessage(
    chatId,
    `Готово: группа привязана к проекту <b>${escapeHtml(company.name)}</b>.\n\n` +
      'Отчёты будут приходить сюда по расписанию из кабинета. ' +
      'Чтобы отключить — отправьте <code>/отвязать</code>.',
  );
}

// -----------------------------------------------------------------------------
// Сообщения
// -----------------------------------------------------------------------------

async function handleMessage(message: TelegramMessage) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = (message.text ?? '').trim();

  // Группа — это не личный чат сотрудника: там бот только принимает команду
  // привязки и молчит на всё остальное. Иначе он отвечал бы «вы не
  // подключены» на каждое сообщение в рабочем чате.
  if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
    return handleGroupCommand(message, text);
  }

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
  // Только что отметили покупку — ждём сумму следующим сообщением.
  if (employee.awaiting_amount_for || employee.awaiting_sale_lead) {
    return saveSaleAmount(chatId, employee, text);
  }

  if (text.includes('показатели')) return showStats(chatId, employee);
  if (text.includes('Недозвон')) return listLeads(chatId, employee, 'no_answer');
  if (text.includes('Мои лиды')) return leadsMenu(chatId, employee);

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

  const rules = company ? resolveShiftRules(employee, company) : null;
  const dayOff =
    company !== null &&
    rules !== null &&
    !rules.workDays.includes(weekdayInZone(new Date(), company.timezone));

  const active = await countActiveLeads(employee.id);
  const lines = [
    late ? '⏰ Смена открыта с опозданием.' : 'Смена открыта. Хорошей работы!',
    place ? `Вы в ${formatDistance(place.distance)} от офиса.` : null,
    rules ? `График: ${formatSchedule(rules)}.` : null,
    dayOff ? 'Сегодня по графику выходной — смена всё равно открыта.' : null,
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
 *
 * В нерабочий день опоздания нет: человек вышел сверх графика, ставить ему за
 * это отметку «опоздал» было бы наказанием за помощь.
 */
function isLate(company: CompanyRow, rules: ShiftRules): boolean {
  const now = new Date();

  if (!rules.workDays.includes(weekdayInZone(now, company.timezone))) return false;

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

function localDate(timeZone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

type CompanyRow = {
  shift_mode: string;
  office_lat: number | null;
  office_lng: number | null;
  office_radius_m: number;
  timezone: string;
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  late_grace_minutes: number;
  funnel_type: string;
  /** Как компания зовёт промежуточный шаг: пробный урок или вебинар. */
  trial_term: string;
  /** Валюта денег компании: в ней продажник и называет сумму. */
  sales_currency: string;
};

async function companyOf(companyId: string): Promise<CompanyRow | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('companies')
    .select(
      'shift_mode, office_lat, office_lng, office_radius_m, timezone, work_start_time, work_end_time, work_days, late_grace_minutes, funnel_type, trial_term, sales_currency',
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

const ACTIVE_STATUSES: LeadStatus[] = ['new', 'no_answer', 'thinking'];

/**
 * Периоды выборки. Кодируются одной буквой: в callback_data Telegram всего
 * 64 байта, а туда же идут статус и место в списке.
 */
type LeadPeriod = 'a' | 't' | 'y' | 'w' | 'm';

const PERIOD_LABEL: Record<LeadPeriod, string> = {
  a: 'За всё время',
  t: 'Сегодня',
  y: 'Вчера',
  w: '7 дней',
  m: '30 дней',
};

function isLeadPeriod(value: string): value is LeadPeriod {
  return value in PERIOD_LABEL;
}

/** Границы периода по времени компании. `a` — без границ. */
function periodWindow(
  period: LeadPeriod,
  timeZone: string,
): { startsAt: string; endsBefore: string } | null {
  if (period === 'a') return null;

  const today = localDate(timeZone);
  const shift = (days: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  if (period === 't') return zonedDayWindow(today, today, timeZone);
  if (period === 'y') return zonedDayWindow(shift(-1), shift(-1), timeZone);
  if (period === 'w') return zonedDayWindow(shift(-6), today, timeZone);
  return zonedDayWindow(shift(-29), today, timeZone);
}

/** «3 сентября» по времени компании — дата заявки в заголовке карточки. */
function leadDay(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString('ru-RU', {
    timeZone,
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Все свои заявки сотрудника за период — по ним считаем сводку.
 *
 * Заявка не исчезает после отметки: менеджер обещал вернуться вечером и
 * должен уметь найти этого человека днём. Раньше бот показывал только новых и
 * недозвоны, а «думает» проваливался в никуда — оставалось ждать напоминания.
 */
async function ownLeads(
  supabase: ReturnType<typeof createAdminSupabase>,
  employee: Employee,
  period: LeadPeriod,
  timeZone: string,
) {
  let query = supabase
    .from('leads')
    .select('id, status')
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id);

  const window = periodWindow(period, timeZone);
  if (window) {
    query = query.gte('created_at', window.startsAt).lt('created_at', window.endsBefore);
  }

  const { data } = await query.limit(1000);
  return data ?? [];
}

/**
 * Сводка «Мои лиды»: сколько в каком статусе и кнопка на каждый.
 *
 * Отсюда менеджер попадает в любую пачку — и в новых, и в тех, кому обещал
 * перезвонить. Ниже — выбор периода: заявку ищут по дате не реже, чем по
 * статусу.
 */
async function leadsMenu(
  chatId: number,
  employee: Employee,
  period: LeadPeriod = 'a',
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);

  if (!(await allowedOnShift(chatId, employee, company))) return;

  const timeZone = company?.timezone ?? 'Asia/Almaty';
  const leads = await ownLeads(supabase, employee, period, timeZone);

  const counts = new Map<string, number>();
  for (const lead of leads) counts.set(lead.status, (counts.get(lead.status) ?? 0) + 1);

  const statuses = leadStatusesFor(
    company?.funnel_type === 'direct' ? 'direct' : 'trial',
  ).filter((status) => (counts.get(status) ?? 0) > 0);

  if (statuses.length === 0) {
    return sendMessage(
      chatId,
      `📋 <b>Мои клиенты</b> · ${PERIOD_LABEL[period].toLowerCase()}\n\nЗа этот период клиентов нет.`,
      { inline: periodButtons(period) },
    );
  }

  const lines = statuses.map((status) => {
    const label = leadStatusFor(status, company?.trial_term).label;
    return `${STATUS_ICON[status]} ${label} — <b>${counts.get(status)}</b>`;
  });

  const rows: InlineButton[][] = [];
  for (let index = 0; index < statuses.length; index += 2) {
    rows.push(
      statuses.slice(index, index + 2).map((status) => ({
        text: `${STATUS_ICON[status]} ${leadStatusFor(status, company?.trial_term).label} ${counts.get(status)}`,
        callback_data: `lq:${status}:${period}:0`,
      })),
    );
  }

  return sendMessage(
    chatId,
    `📋 <b>Мои клиенты</b> · ${PERIOD_LABEL[period].toLowerCase()}\n\n${lines.join('\n')}\n\nВсего: <b>${leads.length}</b>`,
    { inline: [...rows, ...periodButtons(period)] },
  );
}

/** Выбор периода. Текущий помечен галочкой, чтобы было видно, что открыто. */
function periodButtons(current: LeadPeriod): InlineButton[][] {
  const order: LeadPeriod[] = ['t', 'y', 'w', 'm', 'a'];
  const buttons = order.map((period) => ({
    text: `${period === current ? '✅ ' : '📅 '}${PERIOD_LABEL[period]}`,
    callback_data: `lm:${period}`,
  }));
  return [buttons.slice(0, 3), buttons.slice(3)];
}

/**
 * Клиенты одной пачки — по одному за раз.
 *
 * Раньше бот вываливал в чат все заявки подряд: работать с этим невозможно,
 * менеджер тонет в ленте и теряет место. Один клиент — одна карточка, дальше
 * кнопка «Следующий». Порядок — от свежих к старым: последняя заявка нужна
 * чаще всего.
 */
async function listLeads(
  chatId: number,
  employee: Employee,
  status: LeadStatus,
  period: LeadPeriod = 'a',
  offset = 0,
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);

  if (!(await allowedOnShift(chatId, employee, company))) return;

  const timeZone = company?.timezone ?? 'Asia/Almaty';

  let query = supabase
    .from('leads')
    .select('id, name, phone, source, platform, status, creative_id, created_at', {
      count: 'exact',
    })
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id)
    .eq('status', status);

  const window = periodWindow(period, timeZone);
  if (window) {
    query = query.gte('created_at', window.startsAt).lt('created_at', window.endsBefore);
  }

  const { data: leads, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset);

  const total = count ?? 0;
  const lead = leads?.[0];

  if (!lead) {
    const empty =
      status === 'new'
        ? 'Новых клиентов нет. Как появятся — пришлю сюда.'
        : 'Здесь больше никого нет.';
    return sendMessage(chatId, empty, {
      inline: [[{ text: '↩️ Все мои клиенты', callback_data: `lm:${period}` }]],
    });
  }

  const funnelType = company?.funnel_type === 'direct' ? 'direct' : 'trial';
  const creativeName = await shortCreativeLabel(supabase, employee.company_id, lead.creative_id);
  const label = leadStatusFor(lead.status, company?.trial_term).label;

  const header =
    `${STATUS_ICON[lead.status as LeadStatus] ?? '👤'} <b>${escapeHtml(label)} — ${offset + 1} из ${total}</b>\n` +
    `📅 заявка от ${leadDay(lead.created_at, timeZone)}`;

  const footer: InlineButton[] = [];
  if (offset + 1 < total) {
    footer.push({ text: '➡️ Следующий', callback_data: `lq:${status}:${period}:${offset + 1}` });
  }
  footer.push({ text: '↩️ К списку', callback_data: `lm:${period}` });

  return sendMessage(
    chatId,
    leadCard({ ...lead, creativeLabel: creativeName }, header, company?.trial_term),
    {
      inline: [
        ...statusButtons(lead.id, funnelType, company?.trial_term),
        ...whatsappButton(lead.phone),
        footer,
      ],
    },
  );
}

/**
 * Заявки — рабочая информация, и выдаются они только на смене. Иначе бот
 * отдаёт номера человеку, который не работает, и никто не знает, звонит он
 * или нет.
 */
async function allowedOnShift(
  chatId: number,
  employee: Employee,
  company: CompanyRow | null,
): Promise<boolean> {
  const needsShift = company
    ? resolveShiftRules(employee, company).mode !== 'always'
    : true;

  if (!needsShift || (await openShiftOf(employee.id))) return true;

  await sendMessage(
    chatId,
    'Сначала откройте смену — кнопка «Я на смене» ниже.\nЗаявки выдаются только тем, кто на работе.',
    { keyboard: KEYBOARD_OFF },
  );
  return false;
}

/**
 * Личные показатели сотрудника.
 *
 * Свои цифры он должен видеть сам и в любой момент, а не ждать, пока их
 * посчитает директор: человек, который видит свою конверсию, её и правит.
 */
async function showStats(chatId: number, employee: Employee) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);

  const stats = await employeeStats(supabase, {
    companyId: employee.company_id,
    employeeId: employee.id,
    timezone: company?.timezone ?? 'Asia/Almaty',
  });

  const open = await openShiftOf(employee.id);

  return sendMessage(
    chatId,
    statsMessage(stats, {
      title: `📊 <b>${escapeHtml(employee.full_name)}</b> — сегодня, ${formatDay(stats.date)}`,
      currency: company?.sales_currency ?? 'KZT',
      trialTerm: company?.trial_term,
    }),
    { keyboard: open ? KEYBOARD_ON : KEYBOARD_OFF },
  );
}

/** «19 августа» — дата в отчёте читается словами, а не цифрами через дефис. */
function formatDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

async function handleCallback(query: TelegramCallbackQuery) {
  const userId = query.from?.id;
  const chatId = query.message?.chat.id;
  if (!userId || !chatId) return;

  const employee = await findEmployee(userId);
  if (!employee) return answerCallback(query.id, 'Вы не подключены к платформе.');

  const parts = (query.data ?? '').split(':');
  const [kind, leadId, value] = parts;
  if (!leadId) return answerCallback(query.id);

  // Просмотр своих заявок: во втором поле не лид, а статус или период.
  if (kind === 'lm') {
    await answerCallback(query.id);
    return leadsMenu(chatId, employee, isLeadPeriod(leadId) ? leadId : 'a');
  }

  if (kind === 'lq') {
    await answerCallback(query.id);
    return listLeads(
      chatId,
      employee,
      isLeadStatus(leadId) ? leadId : 'new',
      isLeadPeriod(value ?? '') ? (value as LeadPeriod) : 'a',
      Number(parts[3]) || 0,
    );
  }

  if (!value) return answerCallback(query.id);

  if (kind === 's') return applyStatus(query, chatId, employee, leadId, value);
  if (kind === 't') return applyTouch(query, chatId, employee, leadId, value);
  if (kind === 'bd') return pickDay(query, chatId, employee, leadId, value);
  if (kind === 'bt') return pickTime(query, chatId, employee, leadId, value);
  if (kind === 'bs') return pickSeller(query, chatId, employee, leadId, value);
  if (kind === 'tr') return applyTrial(query, chatId, employee, leadId, value);
  if (kind === 'q') return applyQuality(query, chatId, employee, leadId, value);

  return answerCallback(query.id);
}

/**
 * Исход урока, отмеченный продажником.
 *
 * Продажник ведёт своё занятие, а не чужой лид, поэтому право проверяем по
 * записи на урок: занятие должно быть закреплено именно за ним.
 *
 * Отметка — не конец работы, а развилка, ровно как у менеджера. Урок проведён —
 * спрашиваем, чем кончилось решение клиента. Клиент думает или банк не дал
 * рассрочку — спрашиваем, когда вернуться: клиент остался в работе. Не вышел
 * на связь — когда пробовать снова. Куда при этом переезжает сам лид, решает
 * справочник статусов, а не эта функция: то же правило работает и в кабинете.
 */
async function applyTrial(
  query: TelegramCallbackQuery,
  chatId: number,
  employee: Employee,
  trialId: string,
  outcome: string,
) {
  const supabase = createAdminSupabase();

  const { data: trial } = await supabase
    .from('trials')
    .select('id, lead_id, status')
    .eq('id', trialId)
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id)
    .maybeSingle();

  if (!trial) return answerCallback(query.id, 'Это занятие не за вами.');

  if (!isTrialStatus(outcome) || outcome === 'scheduled') {
    return answerCallback(query.id, 'Неизвестный исход урока.');
  }

  const meta = TRIAL_STATUS[outcome];

  const { data: lead } = trial.lead_id
    ? await supabase.from('leads').select('name').eq('id', trial.lead_id).maybeSingle()
    : { data: null };

  const name = escapeHtml(lead?.name || 'Клиент');

  await supabase.from('trials').update({ status: outcome }).eq('id', trial.id);

  // Лид идёт следом за уроком: выручка, воронка и событие в Meta считаются по
  // нему. Иначе продажник отмечает урок в чате, а в разделе «Лиды» человек
  // так и висит записанным на занятие, которое давно прошло.
  if (meta.leadStatus && trial.lead_id) {
    await supabase
      .from('leads')
      .update({ status: meta.leadStatus })
      .eq('id', trial.lead_id)
      .eq('company_id', employee.company_id);
  }

  // Прежнее обещание больше не про этот статус: закрываем до того, как
  // спросим новое, иначе придут два напоминания об одном клиенте.
  if (trial.lead_id && meta.followUp !== 'outcome') {
    await closeOpenTouches(supabase, trial.lead_id);
  }

  if (outcome === 'sale' && trial.lead_id) {
    // Сумму спрашиваем сразу: без неё продажа не попадёт ни в выручку, ни в
    // Meta, а возвращаться за ней потом никто не будет.
    await supabase
      .from('employees')
      .update({ awaiting_amount_for: trial.id })
      .eq('id', employee.id);

    await answerCallback(query.id, 'Продажа отмечена');
    // Валюту не спрашиваем: она одна на компанию и стоит в настройках. Иначе
    // продажник выбирал бы её на каждой продаже, а ошибётся один раз — и в
    // отчёте доход разойдётся в сотни раз.
    const currency = (await companyOf(employee.company_id))?.sales_currency ?? 'KZT';
    return sendMessage(
      chatId,
      `💰 <b>${name}</b> купил курс.\nНа какую сумму? Отправьте число одним сообщением — например <code>390000</code>.\n` +
        `Считаем в <b>${escapeHtml(currency)}</b>. Платили в другой валюте — напишите её рядом: <code>300$</code>.`,
    );
  }

  await answerCallback(query.id, meta.label);

  // Урок провели — решение клиента отдельным вопросом: между занятием и
  // оплатой обычно проходит день-два.
  if (meta.followUp === 'outcome') {
    return sendMessage(
      chatId,
      `✅ Урок с <b>${name}</b> проведён.\nЧем закончилось?`,
      { inline: trialOutcomeButtons(trial.id) },
    );
  }

  if (meta.followUp && trial.lead_id) {
    const callback = meta.followUp === 'callback';
    return sendMessage(
      chatId,
      `<b>${name}</b> — ${meta.label.toLowerCase()}.\n` +
        (callback ? 'Когда попробовать снова?' : 'Когда вернуться к клиенту?'),
      {
        inline: touchButtons(
          trial.lead_id,
          callback ? NO_ANSWER_TOUCHES : THINKING_TOUCHES,
          '🚫 Не напоминать',
        ),
      },
    );
  }

  return sendMessage(chatId, `✅ <b>${name}</b> — ${meta.label.toLowerCase()}.`);
}


/**
 * Смена статуса лида из чата.
 *
 * Отметка — не конец работы, а развилка. Не дозвонился и «думает» требуют
 * назначить, когда вернуться: обещание, записанное в момент разговора, —
 * единственное, которое выполняется. Покупка требует суммы. Отказ закрывает
 * клиента. Во всех прочих случаях бот сразу даёт следующего.
 */
async function applyStatus(
  query: TelegramCallbackQuery,
  chatId: number,
  employee: Employee,
  leadId: string,
  status: string,
) {
  if (!isLeadStatus(status)) return answerCallback(query.id, 'Неизвестный статус.');

  const supabase = createAdminSupabase();
  const lead = await ownLead(employee, leadId);
  if (!lead) return answerCallback(query.id, 'Этот клиент уже не за вами.');

  const { error } = await supabase
    .from('leads')
    .update({ status: status as LeadStatus })
    .eq('id', lead.id)
    .eq('company_id', employee.company_id);

  if (error) return answerCallback(query.id, 'Не удалось сохранить статус.');

  const company = await companyOf(employee.company_id);
  const label = leadStatusFor(status, company?.trial_term).label;
  const name = escapeHtml(lead.name || 'Клиент');

  await answerCallback(query.id, `Статус: ${label}`);

  // Прежнее обещание больше не про этот статус: закрываем до того, как
  // спросим новое, иначе менеджеру придут два напоминания об одном клиенте.
  await closeOpenTouches(supabase, lead.id);

  // Не дозвонился — вернуться надо сегодня же, пока клиент помнит заявку.
  if (status === 'no_answer') {
    return sendMessage(chatId, `📵 <b>${name}</b> не отвечает.\nКогда перезвонить?`, {
      inline: touchButtons(lead.id, NO_ANSWER_TOUCHES, '🚫 Не напоминать'),
    });
  }

  // Взял паузу на решение — сроки длиннее: дёргать через час значит потерять.
  if (status === 'thinking') {
    return sendMessage(chatId, `🤔 <b>${name}</b> думает.\nКогда вернуться?`, {
      inline: touchButtons(lead.id, THINKING_TOUCHES, '🚫 Не напоминать'),
    });
  }

  // Продажа в прямой воронке: урока нет, закрывает тот же менеджер. Сумму
  // спрашиваем сразу — без неё покупка не попадёт ни в выручку, ни в Meta,
  // а возвращаться за ней потом никто не будет.
  if (status === 'sale' && company?.funnel_type === 'direct') {
    await supabase
      .from('employees')
      .update({ awaiting_sale_lead: lead.id })
      .eq('id', employee.id);

    const currency = company.sales_currency ?? 'KZT';
    return sendMessage(
      chatId,
      `💰 <b>${name}</b> купил.\nНа какую сумму? Отправьте число одним сообщением — например <code>35000</code>.\n` +
        `Считаем в <b>${escapeHtml(currency)}</b>. Платили в другой валюте — напишите её рядом: <code>300$</code>.`,
    );
  }

  // «Пробный» — это не просто отметка: у урока должны быть время и продажник.
  if (status === 'trial') {
    const { createdId } = await syncTrialForLead(supabase, {
      companyId: employee.company_id,
      leadId: lead.id,
      status,
      timezone: company?.timezone ?? 'Asia/Almaty',
    });

    const trialId = createdId ?? (await draftTrialOf(employee.company_id, lead.id));

    if (trialId) {
      return sendMessage(
        chatId,
        `🎓 <b>${name}</b> — записываем на урок.\nНа какой день?`,
        { inline: bookingDayButtons(trialId, company?.timezone ?? 'Asia/Almaty') },
      );
    }
  }

  if (status === 'sale') {
    await syncTrialForLead(supabase, {
      companyId: employee.company_id,
      leadId: lead.id,
      status,
      timezone: company?.timezone ?? 'Asia/Almaty',
    });
  }

  await sendMessage(chatId, `✅ <b>${name}</b> → ${label}`);
  return listLeads(chatId, employee, 'new');
}

/**
 * Срок следующего касания, выбранный кнопкой.
 *
 * Клиент остаётся у того же менеджера: второй звонок с другого номера
 * выглядит для человека как спам, а менеджер, у которого отбирают заявки,
 * перестаёт их дожимать.
 */
async function applyTouch(
  query: TelegramCallbackQuery,
  chatId: number,
  employee: Employee,
  leadId: string,
  preset: string,
) {
  const supabase = createAdminSupabase();
  const reach = await reachableLead(employee, leadId);
  if (!reach) return answerCallback(query.id, 'Этот клиент уже не за вами.');

  const { lead, own } = reach;
  const name = escapeHtml(lead.name || 'Клиент');

  // «Не напоминать» — не отказ клиента, а отказ от будильника. Лид остаётся
  // в пачке «📵 Недозвон», вернуться к нему можно руками.
  if (preset === 'skip') {
    await answerCallback(query.id, 'Без напоминания');
    await sendMessage(
      chatId,
      own
        ? `<b>${name}</b> — без напоминания. Найдёте его в «📵 Недозвон».`
        : `<b>${name}</b> — без напоминания.`,
    );
    return own ? listLeads(chatId, employee, 'new') : undefined;
  }

  if (!isTouchPreset(preset)) return answerCallback(query.id, 'Неизвестный срок.');

  const company = await companyOf(employee.company_id);
  const remindAt = resolveTouchTime(preset, company?.timezone ?? 'Asia/Almaty');

  await scheduleTouch(supabase, {
    companyId: employee.company_id,
    leadId: lead.id,
    employeeId: employee.id,
    remindAt,
    // Попытка дозвона считается только тогда, когда её и правда не было:
    // «думает» — это состоявшийся разговор, а не промах.
    countsAsAttempt: lead.status === 'no_answer',
  });

  await answerCallback(query.id, touchPreset(preset).label);
  await sendMessage(chatId, `⏰ <b>${name}</b> — напомню ${untilLabel(remindAt)}.`);

  // Очередь новых — работа менеджера. Продажнику после урока показывать
  // чужую пачку незачем: у него свой список занятий.
  return own ? listLeads(chatId, employee, 'new') : undefined;
}

/**
 * Сумма продажи, присланная из чата.
 *
 * Продажа заводится здесь же и сразу оплаченной: сумму называют после того,
 * как деньги пришли. Ждать её бот может по двум поводам — продажник отметил
 * покупку после урока, либо менеджер прямой воронки нажал «Купил». Клиент в
 * обоих случаях один и тот же, поэтому дальше путь общий.
 */
async function saveSaleAmount(chatId: number, employee: Employee, text: string) {
  const supabase = createAdminSupabase();

  const clear = () =>
    supabase
      .from('employees')
      .update({ awaiting_amount_for: null, awaiting_sale_lead: null })
      .eq('id', employee.id);

  if (/отмен/i.test(text)) {
    await clear();
    return sendMessage(chatId, 'Хорошо, сумму не записываем.', { keyboard: KEYBOARD_ON });
  }

  const leadId = await awaitedLead(employee);
  if (!leadId) {
    await clear();
    return sendMessage(chatId, 'Не нашёл клиента, по которому ждал сумму.');
  }

  const parsed = parseSaleAmount(text);

  if (!parsed) {
    return sendMessage(
      chatId,
      'Не понял сумму. Пришлите число, например <code>390000</code>. ' +
        'В другой валюте — с её названием: <code>300$</code>. Или напишите «отмена».',
    );
  }

  // Чек по этому клиенту мог провести кто-то на платформе, пока сумму
  // набирали здесь. Второй раз записывать нельзя — выручка удвоится.
  // Спрашиваем сразу оценку: за ней он и шёл.
  const { data: paid } = await supabase
    .from('sales')
    .select('amount')
    .eq('company_id', employee.company_id)
    .eq('lead_id', leadId)
    .eq('status', 'paid')
    .limit(1)
    .maybeSingle();

  if (paid) {
    await clear();
    return sendMessage(
      chatId,
      `Продажа по этому клиенту уже проведена: <b>${formatAmount(Number(paid.amount))}</b>.\n\n` +
        'Второй чек записывать не нужно. Осталось оценить клиента.',
      { inline: qualityButtons(leadId) },
    );
  }

  const company = await companyOf(employee.company_id);
  const currency = company?.sales_currency ?? 'KZT';
  const saleDate = localDate(company?.timezone ?? 'Asia/Almaty');

  // Валюту не назвали — значит валюта компании, та самая, что в настройках.
  // Назвали — переводим по курсу Нацбанка на день продажи: в отчётах и в
  // событии для Meta сумма обязана быть в одной валюте, иначе доход
  // компании складывается из тенге и долларов как из одинаковых чисел.
  const converted = await toCompanyCurrency(
    parsed.amount,
    parsed.currency,
    currency,
    saleDate,
  );

  if (!converted) {
    return sendMessage(
      chatId,
      `Не знаю курс ${escapeHtml(parsed.currency ?? '')} на ${saleDate}. ` +
        `Пришлите сумму в ${escapeHtml(currency)}.`,
    );
  }

  const { data: sale } = await supabase
    .from('sales')
    .insert({
      company_id: employee.company_id,
      lead_id: leadId,
      amount: converted.amount,
      status: 'paid',
      sale_date: saleDate,
      // Продавец записывается в саму продажу и дальше не меняется: заявку
      // могут передать другому, а карточку — удалить, но выручка обязана
      // остаться за тем, кто её сделал.
      seller_id: employee.id,
      seller_name: employee.full_name,
    })
    .select('id')
    .maybeSingle();

  await clear();

  if (!sale) {
    return sendMessage(
      chatId,
      'Не удалось сохранить продажу — возможно, её уже провели на платформе. ' +
        'Проверьте раздел «Лиды» или скажите директору.',
    );
  }

  // Пересчёт показываем: продавец должен увидеть, что записалось, а не
  // узнать о расхождении через неделю из отчёта.
  const note = converted.rate
    ? `\n<i>${formatAmount(parsed.amount)} ${escapeHtml(parsed.currency ?? '')} по курсу ${formatAmount(converted.rate)}</i>`
    : '';

  // В Meta событие отсюда не уходит: сначала продавец оценивает клиента, а
  // отправляет его таргетолог. Обучать рекламу на случайном покупателе значит
  // просить её искать таких же.
  return sendMessage(
    chatId,
    `✅ Продажа записана: <b>${formatAmount(converted.amount)} ${escapeHtml(currency)}</b>.${note}\n\nКакой это клиент? От этого зависит, отправлять ли покупку в рекламный кабинет.`,
    { inline: qualityButtons(leadId) },
  );
}

/**
 * Клиент, по которому ждём сумму.
 *
 * В прямой воронке он записан прямо в карточке сотрудника, в школьной — за
 * уроком, который вёл продажник.
 */
async function awaitedLead(employee: Employee): Promise<string | null> {
  if (employee.awaiting_sale_lead) return employee.awaiting_sale_lead;
  if (!employee.awaiting_amount_for) return null;

  const supabase = createAdminSupabase();
  const { data: trial } = await supabase
    .from('trials')
    .select('lead_id')
    .eq('id', employee.awaiting_amount_for)
    .eq('company_id', employee.company_id)
    .maybeSingle();

  return trial?.lead_id ?? null;
}

/**
 * Сумма в валюте компании. Курс берём на день продажи — Нацбанк публикует
 * его каждый рабочий день, и бухгалтерия считает так же.
 *
 * null означает «курса нет»: молча записать доллары как тенге нельзя, разница
 * в отчёте будет в сотни раз.
 */
async function toCompanyCurrency(
  amount: number,
  from: string | null,
  to: string,
  date: string,
): Promise<{ amount: number; rate: number | null } | null> {
  if (!from || from === to) return { amount, rate: null };

  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('exchange_rates')
    .select('date, code, kzt_per_unit')
    .in('code', [from, to])
    .lte('date', date)
    .order('date', { ascending: false })
    .limit(60);

  const rates = createRateLookup(data ?? []);
  const perUnit = rates.kztPerUnit(from, date);
  const targetPerUnit = rates.kztPerUnit(to, date);
  if (!perUnit || !targetPerUnit) return null;

  const rate = perUnit / targetPerUnit;
  return { amount: Math.round(amount * rate), rate: Math.round(rate * 100) / 100 };
}

/** Оценка клиента: её ставит тот, кто с ним разговаривал. */
async function applyQuality(
  query: TelegramCallbackQuery,
  chatId: number,
  employee: Employee,
  leadId: string,
  value: string,
) {
  if (!isLeadQuality(value)) return answerCallback(query.id, 'Неизвестная оценка.');

  const supabase = createAdminSupabase();
  const { data: lead } = await supabase
    .from('leads')
    .update({ quality: value })
    .eq('id', leadId)
    .eq('company_id', employee.company_id)
    .select('name')
    .maybeSingle();

  if (!lead) return answerCallback(query.id, 'Клиент не найден.');

  await answerCallback(query.id, LEAD_QUALITY[value].label);
  return sendMessage(
    chatId,
    `${qualityBadge(value)} — <b>${escapeHtml(lead.name || 'клиент')}</b>.\n${LEAD_QUALITY[value].hint}.`,
    { keyboard: KEYBOARD_ON },
  );
}

/** Суммы читаются глазами: разряды разделяем пробелом. */
function formatAmount(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

/** Урок без назначенного времени — тот, который сейчас записываем. */
async function draftTrialOf(companyId: string, leadId: string): Promise<string | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('trials')
    .select('id')
    .eq('company_id', companyId)
    .eq('lead_id', leadId)
    .is('starts_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// -----------------------------------------------------------------------------
// Запись на урок: день → час → продажник
// -----------------------------------------------------------------------------

/** Шаг 1: выбран день. Запоминаем дату и спрашиваем час. */
async function pickDay(
  query: TelegramCallbackQuery,
  chatId: number,
  employee: Employee,
  trialId: string,
  offset: string,
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);
  const timeZone = company?.timezone ?? 'Asia/Almaty';

  const offsetDays = Number(offset) || 0;
  const day = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const date = localDate(timeZone, day);

  // Сегодняшние часы, которые уже прошли, не предлагаем: урок в прошлом —
  // это урок, о котором никто не напомнит.
  const after = offsetDays === 0 ? nowInZone(timeZone) : undefined;
  const times = bookingTimeButtons(trialId, { after });

  if (times.length === 0) {
    await answerCallback(query.id, 'На сегодня время вышло');
    return sendMessage(chatId, '🌙 На сегодня свободных часов не осталось. Выберите другой день.', {
      inline: bookingDayButtons(trialId, timeZone),
    });
  }

  const { error } = await supabase
    .from('trials')
    .update({ date })
    .eq('id', trialId)
    .eq('company_id', employee.company_id);

  if (error) return answerCallback(query.id, 'Не удалось сохранить день.');

  await answerCallback(query.id, date);
  return sendMessage(chatId, `📅 ${formatDay(date)}. Во сколько урок?`, { inline: times });
}

/** «17:30» по времени компании — чтобы отсечь часы, которые уже прошли. */
function nowInZone(timeZone: string): string {
  return new Date().toLocaleTimeString('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Шаг 2: выбран час. Считаем занятость и показываем продажников. */
async function pickTime(
  query: TelegramCallbackQuery,
  chatId: number,
  employee: Employee,
  trialId: string,
  hhmm: string,
) {
  const time = `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
  if (!BOOKING_HOURS.includes(time)) return answerCallback(query.id, 'Неизвестное время.');

  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);
  const timeZone = company?.timezone ?? 'Asia/Almaty';

  const { data: trial } = await supabase
    .from('trials')
    .select('id, date')
    .eq('id', trialId)
    .eq('company_id', employee.company_id)
    .maybeSingle();

  if (!trial) return answerCallback(query.id, 'Запись не найдена.');

  const startsAt = instantInZone(trial.date, time, timeZone);
  if (!startsAt) return answerCallback(query.id, 'Не удалось разобрать время.');

  // Кнопки могли повисеть в чате, пока менеджер говорил с клиентом. Урок в
  // прошлом принимать нельзя: напоминание о нём уже не придёт.
  if (startsAt.getTime() <= Date.now()) {
    await answerCallback(query.id, 'Это время уже прошло');
    return sendMessage(chatId, '⏰ Это время уже прошло. Выберите день заново.', {
      inline: bookingDayButtons(trialId, timeZone),
    });
  }

  await supabase
    .from('trials')
    .update({ starts_at: startsAt.toISOString() })
    .eq('id', trial.id);

  const sellers = await sellerAvailability(
    supabase,
    employee.company_id,
    startsAt,
    trial.id,
  );

  if (sellers.length === 0) {
    return sendMessage(
      chatId,
      'В компании нет продажников — урок пока не на кого записать. Скажите директору.',
    );
  }

  await answerCallback(query.id, time);
  return sendMessage(
    chatId,
    `🕒 ${formatTrialTime(startsAt, timeZone)}\nКто проводит урок?`,
    { inline: bookingSellerButtons(trial.id, sellers) },
  );
}

/** Шаг 3: выбран продажник. Закрепляем урок и предупреждаем его. */
async function pickSeller(
  query: TelegramCallbackQuery,
  chatId: number,
  employee: Employee,
  trialId: string,
  index: string,
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);
  const timeZone = company?.timezone ?? 'Asia/Almaty';

  const { data: trial } = await supabase
    .from('trials')
    .select('id, lead_id, starts_at')
    .eq('id', trialId)
    .eq('company_id', employee.company_id)
    .maybeSingle();

  if (!trial?.starts_at) return answerCallback(query.id, 'Сначала выберите время.');

  const startsAt = new Date(trial.starts_at);
  const sellers = await sellerAvailability(
    supabase,
    employee.company_id,
    startsAt,
    trial.id,
  );
  const seller = sellers[Number(index)];

  if (!seller) return answerCallback(query.id, 'Продажник не найден.');

  // Занятость перепроверяем здесь: пока менеджер выбирал, этот час мог занять
  // другой менеджер.
  if (seller.busy) {
    await answerCallback(query.id, 'Занят в это время');
    return sendMessage(
      chatId,
      `${escapeHtml(seller.fullName)} уже ведёт урок в это время. Выберите другого или другой час.`,
      { inline: bookingSellerButtons(trial.id, sellers) },
    );
  }

  await supabase
    .from('trials')
    .update({ assigned_to: seller.id, assigned_at: new Date().toISOString() })
    .eq('id', trial.id);

  const sent = trial.lead_id
    ? await notifyTrialBooked(
        supabase,
        employee.company_id,
        trial.lead_id,
        startsAt,
        seller.id,
        timeZone,
      )
    : { delivered: false, reason: 'у записи нет клиента' };

  await answerCallback(query.id, 'Урок записан');

  // Молча терять уведомление нельзя: менеджер уйдёт уверенным, что продажник
  // предупреждён, а тот об уроке не узнает.
  const note = sent.delivered
    ? `Продажник ${escapeHtml(seller.fullName)} предупреждён.`
    : `⚠️ ${escapeHtml(seller.fullName)} не получил уведомление: ${sent.reason}. Сообщите ему сами.`;

  await sendMessage(
    chatId,
    `✅ Урок записан: ${formatTrialTime(startsAt, timeZone)}, проводит ${escapeHtml(seller.fullName)}.\n${note}`,
  );

  return listLeads(chatId, employee, 'new');
}

type OwnLead = { id: string; name: string; status: string; touch_count: number };

/** Сотрудник двигает только свои лиды и только внутри своей компании. */
async function ownLead(employee: Employee, leadId: string): Promise<OwnLead | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('leads')
    .select('id, name, status, touch_count')
    .eq('id', leadId)
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id)
    .maybeSingle();
  return data ?? null;
}

/**
 * Клиент, с которым сотруднику можно работать.
 *
 * У менеджера это его заявка. У продажника заявка чужая — она закреплена за
 * менеджером, который её дозвонил, — но урок ведёт он, и обещание «вернусь к
 * нему в четверг» после урока даёт тоже он. Тот же круг доступа описан
 * правилом чтения заявок в самой базе, здесь оно повторено для бота: у него
 * пользовательской сессии нет, он ходит сервисным ключом.
 */
async function reachableLead(
  employee: Employee,
  leadId: string,
): Promise<{ lead: OwnLead; own: boolean } | null> {
  const own = await ownLead(employee, leadId);
  if (own) return { lead: own, own: true };

  const supabase = createAdminSupabase();

  const { data: trial } = await supabase
    .from('trials')
    .select('id')
    .eq('company_id', employee.company_id)
    .eq('lead_id', leadId)
    .eq('assigned_to', employee.id)
    .maybeSingle();

  if (!trial) return null;

  const { data } = await supabase
    .from('leads')
    .select('id, name, status, touch_count')
    .eq('id', leadId)
    .eq('company_id', employee.company_id)
    .maybeSingle();

  return data ? { lead: data, own: false } : null;
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
  work_end_time: string | null;
  work_days: number[] | null;
  late_grace_minutes: number | null;
  /** Урок, по которому бот ждёт сумму продажи. */
  awaiting_amount_for: string | null;
  /** Лид, по которому бот ждёт сумму: в прямой воронке урока нет. */
  awaiting_sale_lead: string | null;
};

async function findEmployee(telegramUserId: number): Promise<Employee | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('employees')
    .select(
      'id, company_id, full_name, role, shift_mode, work_start_time, work_end_time, work_days, late_grace_minutes, awaiting_amount_for, awaiting_sale_lead',
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
  chat: { id: number; type?: string; title?: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  location?: { latitude: number; longitude: number };
};

type TelegramCallbackQuery = {
  id: string;
  from?: { id: number };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
};
