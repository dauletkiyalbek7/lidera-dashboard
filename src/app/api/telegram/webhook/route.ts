import { NextResponse } from 'next/server';

import {
  isLeadStatus,
  leadStatusFor,
  leadStatusesFor,
  type LeadStatus,
} from '@/lib/lead-status';
import {
  TRIAL_STATUS,
  TRIAL_STATUS_ORDER,
  isTrialStatus,
  type TrialStatus,
} from '@/lib/trial-status';
import { trialWords } from '@/lib/trial-term';
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
import { instantInZone } from '@/lib/lead-touches';
import { closeOpenTouches } from '@/lib/touch-runner';
import { employeeStats, statsMessage } from '@/lib/employee-stats';
import {
  formatTrialTime,
  daySlots,
  pickSellerForTrial,
  notifyTrialBooked,
  shortCreativeLabel,
  syncTrialForLead,
} from '@/lib/trials';
import { LEAD_QUALITY, isLeadQuality, qualityBadge } from '@/lib/lead-quality';
import { createAdminSupabase, isAdminConfigured } from '@/lib/supabase/admin';
import {
  leadCard,
  statusButtons,
  trialButtons,
  trialOutcomeButtons,
  bookingDayButtons,
  bookingTimeButtons,
  qualityButtons,
  whatsappButton,
  STATUS_ICON,
  BOOKING_HOURS,
  escapeHtml,
} from '@/lib/telegram-lead-card';
import {
  answerCallback,
  editMessageText,
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

/**
 * Клавиатура зависит от роли: работа у людей разная.
 *
 * Менеджер ведёт заявки, продажник — уроки. Пока кнопка была одна на всех,
 * продажник жал «Мои лиды» и видел пустоту: заявки закреплены за менеджером,
 * а его уроки в чате было не найти вовсе — только ждать, когда бот пришлёт
 * карточку, и не потерять её в переписке.
 */
function keyboardFor(role: string, onShift: boolean): KeyboardButton[][] {
  const shift = onShift ? '🔴 Я ухожу' : '🟢 Я на смене';

  if (role === 'salesperson') {
    return [[shift], ['🎓 Мои уроки'], ['📊 Мои показатели']];
  }

  // «Недозвон» отдельной кнопкой убран: это одна из пачек внутри «Моих
  // лидов», и две двери в одну комнату только путали.
  return [[shift], ['📋 Мои лиды'], ['📊 Мои показатели']];
}

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
    return sendMessage(chatId, 'Хорошо, смену не открываем.', {
      keyboard: keyboardFor(employee.role, false),
    });
  }
  if (text.includes('на смене')) return startShiftFlow(chatId, employee);
  if (text.includes('ухожу')) return closeShift(chatId, employee);
  // Только что отметили покупку — ждём сумму следующим сообщением.
  if (employee.awaiting_amount_for || employee.awaiting_sale_lead) {
    return saveSaleAmount(chatId, employee, text);
  }

  if (text.includes('показатели')) return showStats({ chatId }, employee);
  if (text.includes('Мои уроки')) return trialsMenu({ chatId }, employee);
  if (text.includes('Недозвон') || text.includes('Мои лиды')) {
    const stop = await bookingGate({ chatId }, employee, () =>
      sendMessage(chatId, `⏳ ${GATE_HINT}.`),
    );
    if (stop) return;

    return text.includes('Недозвон')
      ? listLeads({ chatId }, employee, 'no_answer')
      : leadsMenu({ chatId }, employee);
  }

  const open = await openShiftOf(employee.id);
  return sendMessage(
    chatId,
    `Привет, ${escapeHtml(employee.full_name)}!\nВыберите действие на клавиатуре ниже.`,
    { keyboard: keyboardFor(employee.role, Boolean(open)) },
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
    .select('id, full_name, status, role')
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
    `Готово, ${escapeHtml(employee.full_name)}. Аккаунт привязан.\n\nНачинайте рабочий день кнопкой «Я на смене» — работа будет приходить сюда.`,
    { keyboard: keyboardFor(employee.role, false) },
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
    return sendMessage(chatId, 'Смена уже открыта.', {
      keyboard: keyboardFor(employee.role, true),
    });
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
      { keyboard: keyboardFor(employee.role, false) },
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
    keyboard: keyboardFor(employee.role, true),
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

  if (!shift) {
    return sendMessage(chatId, 'Смена не открыта.', {
      keyboard: keyboardFor(employee.role, false),
    });
  }

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
    { keyboard: keyboardFor(employee.role, false) },
  );
}

// -----------------------------------------------------------------------------
// Лиды
// -----------------------------------------------------------------------------

const ACTIVE_STATUSES: LeadStatus[] = ['new', 'no_answer', 'thinking'];

/**
 * Куда рисовать ответ.
 *
 * Работа с клиентом — это один экран, а не лента. Пока каждое нажатие слало
 * новое сообщение, чат за смену превращался в простыню из полусотни карточек:
 * менеджер листал вверх, искал, где он остановился, и терял место. Поэтому
 * нажатие кнопки перерисовывает то же сообщение — карточка сменяется
 * карточкой, а не уезжает вниз.
 *
 * `messageId` есть только у нажатия кнопки. Команда с клавиатуры открывает
 * новый экран: ей перерисовывать нечего.
 */
type Screen = { chatId: number; messageId?: number };

async function show(
  screen: Screen,
  text: string,
  inline?: InlineButton[][],
): Promise<void> {
  if (screen.messageId === undefined) {
    await sendMessage(screen.chatId, text, { inline });
    return;
  }

  // Старое сообщение Telegram править отказывается. Молча проглотить отказ
  // нельзя: менеджер нажал кнопку и не увидел бы ничего — присылаем новое.
  // Но повторное нажатие той же кнопки — это не отказ, а «и так уже показано»:
  // новая карточка здесь только плодила бы копии одного и того же экрана.
  const edited = await editMessageText(screen.chatId, screen.messageId, text, inline);
  if (edited === 'failed') await sendMessage(screen.chatId, text, { inline });
}

/**
 * Периоды выборки. Кодируются одной буквой: в callback_data Telegram всего
 * 64 байта, а туда же идут статус и место в списке.
 */
type LeadPeriod = 'a' | 't' | 'y' | 'w' | 'm' | 'h';

const PERIOD_LABEL: Record<LeadPeriod, string> = {
  a: 'За всё время',
  t: 'Сегодня',
  y: 'Вчера',
  w: '7 дней',
  m: '30 дней',
  h: 'Полгода',
};

function isLeadPeriod(value: string): value is LeadPeriod {
  return value in PERIOD_LABEL;
}

/** Даты периода в календаре компании. `a` — без границ. */
function periodDates(
  period: LeadPeriod,
  timeZone: string,
): { from: string; to: string } | null {
  if (period === 'a') return null;

  const today = localDate(timeZone);
  const shift = (days: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  if (period === 't') return { from: today, to: today };
  if (period === 'y') return { from: shift(-1), to: shift(-1) };
  if (period === 'w') return { from: shift(-6), to: today };
  if (period === 'm') return { from: shift(-29), to: today };
  return { from: shift(-179), to: today };
}

/** Границы периода моментами времени — для полей с точным временем. */
function periodWindow(
  period: LeadPeriod,
  timeZone: string,
): { startsAt: string; endsBefore: string } | null {
  const dates = periodDates(period, timeZone);
  return dates ? zonedDayWindow(dates.from, dates.to, timeZone) : null;
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
  screen: Screen,
  employee: Employee,
  period: LeadPeriod = 'a',
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);

  if (!(await allowedOnShift(screen.chatId, employee, company))) return;

  const timeZone = company?.timezone ?? 'Asia/Almaty';
  const leads = await ownLeads(supabase, employee, period, timeZone);

  const counts = new Map<string, number>();
  for (const lead of leads) counts.set(lead.status, (counts.get(lead.status) ?? 0) + 1);

  const statuses = leadStatusesFor(
    company?.funnel_type === 'direct' ? 'direct' : 'trial',
  ).filter((status) => (counts.get(status) ?? 0) > 0);

  if (statuses.length === 0) {
    return show(
      screen,
      `📋 <b>Мои клиенты</b> · ${PERIOD_LABEL[period].toLowerCase()}\n\nЗа этот период клиентов нет.`,
      periodButtons(period),
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

  return show(
    screen,
    `📋 <b>Мои клиенты</b> · ${PERIOD_LABEL[period].toLowerCase()}\n\n${lines.join('\n')}\n\nВсего: <b>${leads.length}</b>`,
    [...rows, ...periodButtons(period)],
  );
}

/**
 * Выбор периода. Текущий помечен галочкой, чтобы было видно, что открыто.
 * `kind` разводит два списка: клиенты менеджера и уроки продажника.
 */
function periodButtons(
  current: LeadPeriod,
  kind: 'lm' | 'um' | 'sm' = 'lm',
): InlineButton[][] {
  const order: LeadPeriod[] = ['t', 'y', 'w', 'm', 'h', 'a'];
  const buttons = order.map((period) => ({
    text: `${period === current ? '✅ ' : '📅 '}${PERIOD_LABEL[period]}`,
    callback_data: `${kind}:${period}`,
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
  screen: Screen,
  employee: Employee,
  status: LeadStatus,
  period: LeadPeriod = 'a',
  offset = 0,
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);

  if (!(await allowedOnShift(screen.chatId, employee, company))) return;

  const timeZone = company?.timezone ?? 'Asia/Almaty';

  let query = supabase
    .from('leads')
    .select(
      'id, name, phone, source, platform, status, creative_id, created_at, last_touch_at',
      { count: 'exact' },
    )
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
    return show(screen, empty, [
      [{ text: '↩️ Все мои клиенты', callback_data: `lm:${period}` }],
    ]);
  }

  const funnelType = company?.funnel_type === 'direct' ? 'direct' : 'trial';
  const creativeName = await shortCreativeLabel(supabase, employee.company_id, lead.creative_id);
  const label = leadStatusFor(lead.status, company?.trial_term).label;
  const trialNote = await trialNoteFor(supabase, employee.company_id, lead.id);
  const contact = await lastContactNote(supabase, employee.company_id, lead, timeZone);

  const header =
    `${STATUS_ICON[lead.status as LeadStatus] ?? '👤'} <b>${escapeHtml(label)} — ${offset + 1} из ${total}</b>\n` +
    `📅 заявка от ${leadDay(lead.created_at, timeZone)}` +
    (contact ? `\n<i>${escapeHtml(contact)}</i>` : '');

  const footer: InlineButton[] = [];
  if (offset + 1 < total) {
    footer.push({ text: '➡️ Следующий', callback_data: `lq:${status}:${period}:${offset + 1}` });
  }
  footer.push({ text: '↩️ К списку', callback_data: `lm:${period}` });

  return show(
    screen,
    leadCard(
      { ...lead, creativeLabel: creativeName, trialNote },
      header,
      company?.trial_term,
    ),
    [
      ...statusButtons(lead.id, funnelType, company?.trial_term),
      ...whatsappButton(lead.phone),
      footer,
    ],
  );
}

/**
 * Когда с клиентом последний раз общались.
 *
 * Сначала переписка: если номер подключён к нашему WhatsApp, там видно живой
 * след — кто написал последним и когда. Это единственный честный ответ на
 * вопрос «он вообще на связи». Когда клиент в последний раз заходил в сам
 * WhatsApp, не знает никто, кроме WhatsApp: наружу он этого не отдаёт.
 *
 * Если переписки нет — показываем свою отметку: когда менеджер последний раз
 * работал с этим клиентом.
 */
async function lastContactNote(
  supabase: ReturnType<typeof createAdminSupabase>,
  companyId: string,
  lead: { id: string; last_touch_at: string | null },
  timeZone: string,
): Promise<string | null> {
  const { data: message } = await supabase
    .from('whatsapp_messages')
    .select('direction, sent_at, created_at')
    .eq('company_id', companyId)
    .eq('lead_id', lead.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (message) {
    const when = momentLabel(message.sent_at ?? message.created_at, timeZone);
    return message.direction === 'in'
      ? `WhatsApp: клиент писал ${when}`
      : `WhatsApp: мы писали ${when}`;
  }

  if (lead.last_touch_at) {
    return `Вы работали с ним ${momentLabel(lead.last_touch_at, timeZone)}`;
  }

  return null;
}

/** «сегодня в 14:20», «вчера в 18:40», «3 сентября в 14:20». */
function momentLabel(value: string, timeZone: string): string {
  const time = new Date(value).toLocaleTimeString('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });

  const day = localDate(timeZone, new Date(value));
  const today = localDate(timeZone);

  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  if (day === today) return `сегодня в ${time}`;
  if (day === yesterday.toISOString().slice(0, 10)) return `вчера в ${time}`;

  return `${leadDay(value, timeZone)} в ${time}`;
}

/**
 * Что с уроком этого клиента: «Думает · Айгерим».
 *
 * Менеджеру это нужно, чтобы не дёргать человека, которого сейчас ведёт
 * продажник, и чтобы видеть, чем кончилось занятие, которое он же и записал.
 */
async function trialNoteFor(
  supabase: ReturnType<typeof createAdminSupabase>,
  companyId: string,
  leadId: string,
): Promise<string | null> {
  const { data: trial } = await supabase
    .from('trials')
    .select('status, assigned_to')
    .eq('company_id', companyId)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!trial) return null;

  const label = TRIAL_STATUS[trial.status as keyof typeof TRIAL_STATUS]?.label ?? trial.status;

  if (!trial.assigned_to) return `${label} · продажник не назначен`;

  const { data: seller } = await supabase
    .from('employees')
    .select('full_name')
    .eq('id', trial.assigned_to)
    .maybeSingle();

  return seller ? `${label} · ${seller.full_name}` : label;
}

/**
 * Сводка «Мои уроки» — рабочий стол продажника.
 *
 * До сих пор его уроки жили только в присланных карточках: потерял сообщение
 * в переписке — и не помнишь, кого и когда ведёшь. Заявки ему не помогали,
 * они закреплены за менеджером. Теперь у него свой список, устроенный так же,
 * как «Мои клиенты» у менеджера.
 */
async function trialsMenu(screen: Screen, employee: Employee, period: LeadPeriod = 'a') {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);

  if (!(await allowedOnShift(screen.chatId, employee, company))) return;

  const timeZone = company?.timezone ?? 'Asia/Almaty';
  const words = trialWords(company?.trial_term);
  const rows = await ownTrials(supabase, employee, period, timeZone);

  const counts = new Map<string, number>();
  for (const trial of rows) counts.set(trial.status, (counts.get(trial.status) ?? 0) + 1);

  const statuses = TRIAL_STATUS_ORDER.filter((status) => (counts.get(status) ?? 0) > 0);
  const title = `🎓 <b>${escapeHtml(words.section)}</b> · ${PERIOD_LABEL[period].toLowerCase()}`;

  if (statuses.length === 0) {
    return show(screen, `${title}\n\nЗа этот период занятий нет.`, periodButtons(period, 'um'));
  }

  const lines = statuses.map(
    (status) => `${TRIAL_ICON[status]} ${TRIAL_STATUS[status].label} — <b>${counts.get(status)}</b>`,
  );

  // Ближайший урок — первое, что продажник ищет глазами: к нему готовиться
  // прямо сейчас. Ради этой строки не надо открывать пачку и листать.
  const next = await nextLesson(supabase, employee, timeZone);
  if (next) lines.unshift(`⏭ <b>Ближайший:</b> ${next}`, '');

  const buttons: InlineButton[][] = [];
  for (let index = 0; index < statuses.length; index += 2) {
    buttons.push(
      statuses.slice(index, index + 2).map((status) => ({
        text: `${TRIAL_ICON[status]} ${TRIAL_STATUS[status].label} ${counts.get(status)}`,
        callback_data: `uq:${status}:${period}:0`,
      })),
    );
  }

  return show(
    screen,
    `${title}\n\n${lines.join('\n')}\n\nВсего: <b>${rows.length}</b>`,
    [...buttons, ...periodButtons(period, 'um')],
  );
}

/** «сегодня в 15:00 · Айару» — ближайшее назначенное занятие. */
async function nextLesson(
  supabase: ReturnType<typeof createAdminSupabase>,
  employee: Employee,
  timeZone: string,
): Promise<string | null> {
  const { data: trial } = await supabase
    .from('trials')
    .select('starts_at, lead_id')
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id)
    .eq('status', 'scheduled')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!trial?.starts_at) return null;

  const { data: lead } = trial.lead_id
    ? await supabase.from('leads').select('name').eq('id', trial.lead_id).maybeSingle()
    : { data: null };

  const when = momentLabel(trial.starts_at, timeZone);
  return lead?.name ? `${when} · ${escapeHtml(lead.name)}` : when;
}

/** Значки исходов урока — те же, что на кнопках продажника. */
const TRIAL_ICON: Record<TrialStatus, string> = {
  scheduled: '🕒',
  completed: '✅',
  thinking: '🤔',
  sale: '💰',
  bank_declined: '🏦',
  rejected: '🚫',
  no_show: '📵',
  canceled: '🔄',
};

async function ownTrials(
  supabase: ReturnType<typeof createAdminSupabase>,
  employee: Employee,
  period: LeadPeriod,
  timeZone: string,
) {
  let query = supabase
    .from('trials')
    .select('id, status')
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id);

  const window = periodWindow(period, timeZone);
  if (window) {
    query = query
      .gte('date', window.startsAt.slice(0, 10))
      .lte('date', window.endsBefore.slice(0, 10));
  }

  const { data } = await query.limit(1000);
  return data ?? [];
}

/**
 * Уроки одной пачки — по одному за раз.
 *
 * Назначенные идут от ближайшего: продажнику важно, к чему готовиться прямо
 * сейчас. Закрытые — наоборот, от свежих: там он ищет то, что было недавно.
 */
async function listTrials(
  screen: Screen,
  employee: Employee,
  status: TrialStatus,
  period: LeadPeriod = 'a',
  offset = 0,
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);

  if (!(await allowedOnShift(screen.chatId, employee, company))) return;

  const timeZone = company?.timezone ?? 'Asia/Almaty';
  const upcoming = status === 'scheduled';

  let query = supabase
    .from('trials')
    .select('id, lead_id, status, date, starts_at', { count: 'exact' })
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id)
    .eq('status', status);

  const window = periodWindow(period, timeZone);
  if (window) {
    query = query
      .gte('date', window.startsAt.slice(0, 10))
      .lte('date', window.endsBefore.slice(0, 10));
  }

  const { data: found, count } = await query
    .order('starts_at', { ascending: upcoming, nullsFirst: false })
    .range(offset, offset);

  const total = count ?? 0;
  const trial = found?.[0];

  const back: InlineButton[][] = [[{ text: '↩️ Все мои уроки', callback_data: `um:${period}` }]];

  if (!trial) return show(screen, 'Здесь больше ничего нет.', back);

  const { data: lead } = trial.lead_id
    ? await supabase
        .from('leads')
        .select('name, phone, source, platform, status, creative_id')
        .eq('id', trial.lead_id)
        .maybeSingle()
    : { data: null };

  if (!lead) return show(screen, 'У этой записи нет клиента.', back);

  const creativeName = await shortCreativeLabel(supabase, employee.company_id, lead.creative_id);
  const meta = TRIAL_STATUS[status];

  const header =
    `${TRIAL_ICON[status]} <b>${escapeHtml(meta.label)} — ${offset + 1} из ${total}</b>\n` +
    (trial.starts_at
      ? `🕒 ${formatTrialTime(trial.starts_at, timeZone)}`
      : `📅 ${formatDay(trial.date)} · время не назначено`);

  // Кнопки по стадии: пока урок не провели — про сам урок, после — про
  // решение клиента. Закрытому уроку нажимать уже нечего.
  const actions = meta.closed
    ? []
    : meta.held
      ? trialOutcomeButtons(trial.id)
      : trialButtons(trial.id);

  const footer: InlineButton[] = [];
  if (offset + 1 < total) {
    footer.push({ text: '➡️ Следующий', callback_data: `uq:${status}:${period}:${offset + 1}` });
  }
  footer.push({ text: '↩️ Все мои уроки', callback_data: `um:${period}` });

  return show(
    screen,
    leadCard({ ...lead, creativeLabel: creativeName }, header, company?.trial_term),
    [...actions, ...whatsappButton(lead.phone), footer],
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
    'Сначала откройте смену — кнопка «Я на смене» ниже.\nРабота выдаётся только тем, кто на смене.',
    { keyboard: keyboardFor(employee.role, false) },
  );
  return false;
}

/**
 * Личные показатели сотрудника.
 *
 * Свои цифры он должен видеть сам и в любой момент, а не ждать, пока их
 * посчитает директор: человек, который видит свою конверсию, её и правит.
 */
async function showStats(
  screen: Screen,
  employee: Employee,
  period: LeadPeriod = 't',
) {
  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);
  const timeZone = company?.timezone ?? 'Asia/Almaty';

  // «За всё время» — это тоже период, просто с очень ранним началом: считать
  // его отдельной веткой значит завести второй путь для тех же цифр.
  const dates = periodDates(period, timeZone) ?? {
    from: '2000-01-01',
    to: localDate(timeZone),
  };

  const stats = await employeeStats(supabase, {
    companyId: employee.company_id,
    employeeId: employee.id,
    timezone: timeZone,
    from: dates.from,
    to: dates.to,
    label: PERIOD_LABEL[period].toLowerCase(),
  });

  // Заголовок называет период словами и датами сразу: «за 7 дней» без чисел
  // читается по-разному, если открыть отчёт назавтра.
  const range =
    dates.from === dates.to
      ? formatDay(dates.to)
      : `${formatDay(dates.from)} — ${formatDay(dates.to)}`;

  return show(
    screen,
    statsMessage(stats, {
      title: `📊 <b>${escapeHtml(employee.full_name)}</b>\n${PERIOD_LABEL[period]} · ${range}`,
      currency: company?.sales_currency ?? 'KZT',
      trialTerm: company?.trial_term,
      funnelType: company?.funnel_type === 'direct' ? 'direct' : 'trial',
    }),
    periodButtons(period, 'sm'),
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

  // Перерисовываем то сообщение, с которого нажали: клиент сменяется клиентом
  // на месте, а не уезжает вниз новой карточкой.
  const screen: Screen = { chatId, messageId: query.message?.message_id };

  const employee = await findEmployee(userId);
  if (!employee) return answerCallback(query.id, 'Вы не подключены к платформе.');

  const parts = (query.data ?? '').split(':');
  const [kind, leadId, value] = parts;
  if (!leadId) return answerCallback(query.id);

  // Незаконченная запись на урок держит менеджера на месте: пока у клиента нет
  // времени и продажника, урок существует только на словах, а другие заявки
  // подождут. Кнопки самой записи, разумеется, пропускаем — иначе закончить
  // её было бы нечем.
  if (GATED_ACTIONS.includes(kind)) {
    const stop = await bookingGate(screen, employee, () => answerCallback(query.id, GATE_HINT));
    if (stop) return;
  }

  // Просмотр своих заявок: во втором поле не лид, а статус или период.
  if (kind === 'lm') {
    await answerCallback(query.id);
    return leadsMenu(screen, employee, isLeadPeriod(leadId) ? leadId : 'a');
  }

  if (kind === 'lq') {
    await answerCallback(query.id);
    return listLeads(
      screen,
      employee,
      isLeadStatus(leadId) ? leadId : 'new',
      isLeadPeriod(value ?? '') ? (value as LeadPeriod) : 'a',
      Number(parts[3]) || 0,
    );
  }

  // Занятый час. Нажимается — иначе Telegram крутил бы часики, — но только
  // чтобы объяснить, почему на него нельзя записать.
  if (kind === 'bx') {
    return answerCallback(query.id, `${leadId} — это время уже занято. Выберите другое.`);
  }

  // Показатели: во втором поле период.
  if (kind === 'sm') {
    await answerCallback(query.id);
    return showStats(screen, employee, isLeadPeriod(leadId) ? leadId : 't');
  }

  // Уроки продажника: во втором поле статус урока или период.
  if (kind === 'um') {
    await answerCallback(query.id);
    return trialsMenu(screen, employee, isLeadPeriod(leadId) ? leadId : 'a');
  }

  if (kind === 'uq') {
    await answerCallback(query.id);
    return listTrials(
      screen,
      employee,
      isTrialStatus(leadId) ? leadId : 'scheduled',
      isLeadPeriod(value ?? '') ? (value as LeadPeriod) : 'a',
      Number(parts[3]) || 0,
    );
  }

  if (!value) return answerCallback(query.id);

  if (kind === 's') return applyStatus(query, screen, employee, leadId, value);
  if (kind === 'bc') return cancelBooking(query, screen, employee, leadId, value);
  if (kind === 'bd') return pickDay(query, screen, employee, leadId, value);
  if (kind === 'bt') return pickTime(query, screen, employee, leadId, value);
  if (kind === 'tr') return applyTrial(query, screen, employee, leadId, value);
  if (kind === 'q') return applyQuality(query, screen, employee, leadId, value);

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
  screen: Screen,
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
    // Сумму присылают текстом, поэтому вопрос уходит отдельным сообщением:
    // ответ должен встать в чате под ним, а не под старой карточкой.
    await show(screen, `💰 <b>${name}</b> — покупка отмечена. Жду сумму.`);
    return sendMessage(
      screen.chatId,
      `На какую сумму? Отправьте число одним сообщением — например <code>390000</code>.\n` +
        `Считаем в <b>${escapeHtml(currency)}</b>. Платили в другой валюте — напишите её рядом: <code>300$</code>.`,
    );
  }

  await answerCallback(query.id, meta.label);

  // Урок провели — решение клиента отдельным вопросом: между занятием и
  // оплатой обычно проходит день-два.
  if (meta.followUp === 'outcome') {
    return show(
      screen,
      `✅ Урок с <b>${name}</b> проведён.\nЧем закончилось?`,
      trialOutcomeButtons(trial.id),
    );
  }

  return show(screen, `✅ <b>${name}</b> — ${meta.label.toLowerCase()}.`);
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
  screen: Screen,
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

  // Прежнее обещание больше не про этот статус: напоминание о нём только
  // сбивало бы с толку.
  await closeOpenTouches(supabase, lead.id);

  // Отметка о работе: раньше её ставило назначение напоминания, а оно стало
  // делом добровольным. Без этой записи «когда с клиентом последний раз
  // говорили» знать неоткуда. Безрезультатной попыткой считаем только
  // недозвон: «думает» — это состоявшийся разговор.
  await supabase
    .from('leads')
    .update({
      last_touch_at: new Date().toISOString(),
      touch_count: (lead.touch_count ?? 0) + (status === 'no_answer' ? 1 : 0),
    })
    .eq('id', lead.id)
    .eq('company_id', employee.company_id);

  // Продажа в прямой воронке: урока нет, закрывает тот же менеджер. Сумму
  // спрашиваем сразу — без неё покупка не попадёт ни в выручку, ни в Meta,
  // а возвращаться за ней потом никто не будет.
  if (status === 'sale' && company?.funnel_type === 'direct') {
    await supabase
      .from('employees')
      .update({ awaiting_sale_lead: lead.id })
      .eq('id', employee.id);

    const currency = company.sales_currency ?? 'KZT';
    // Сумму присылают текстом — вопрос уходит отдельным сообщением, чтобы
    // ответ встал под ним, а не под старой карточкой.
    await show(screen, `💰 <b>${name}</b> — покупка отмечена. Жду сумму.`);
    return sendMessage(
      screen.chatId,
      `На какую сумму? Отправьте число одним сообщением — например <code>35000</code>.\n` +
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
      return show(
        screen,
        `🎓 <b>${name}</b> — записываем на урок.\nНа какой день?`,
        bookingDayButtons(trialId, company?.timezone ?? 'Asia/Almaty', lead.status),
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

  return listLeads(screen, employee, 'new');
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
    return sendMessage(chatId, 'Хорошо, сумму не записываем.', {
      keyboard: keyboardFor(employee.role, true),
    });
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
  screen: Screen,
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
  return show(
    screen,
    `${qualityBadge(value)} — <b>${escapeHtml(lead.name || 'клиент')}</b>.\n${LEAD_QUALITY[value].hint}.`,
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

/**
 * Незаконченная запись на урок.
 *
 * «Пробный» нажат, а времени у урока нет — значит продажник о клиенте не
 * знает, и урока на самом деле не существует. Такие черновики копились молча:
 * менеджер отвлекался на следующего клиента и не возвращался.
 */
type PendingTrialRow = { id: string; leads: { name: string | null } | null };

async function pendingBooking(
  employee: Employee,
): Promise<{ id: string; name: string } | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('trials')
    .select('id, leads!inner(name, assigned_to)')
    .eq('company_id', employee.company_id)
    .eq('status', 'scheduled')
    .is('starts_at', null)
    .eq('leads.assigned_to', employee.id)
    .order('created_at')
    .limit(1);

  const row = (data as unknown as PendingTrialRow[] | null)?.[0];
  return row ? { id: row.id, name: row.leads?.name || 'Клиент' } : null;
}

/** Действия, которые ждут, пока запись на урок закончат. */
const GATED_ACTIONS = ['lm', 'lq', 's'];

const GATE_HINT = 'Сначала закончите запись на урок';

/**
 * Не пускать дальше, пока урок без времени.
 *
 * Возвращает true, если ход не сделан: вызывающий на этом останавливается.
 * Продажника это не касается — записывает менеджер.
 */
async function bookingGate(
  screen: Screen,
  employee: Employee,
  notify: () => Promise<unknown>,
): Promise<boolean> {
  // Записывает тот, кто ведёт заявку: обычно менеджер, но пока их нет —
  // руководитель отдела. Продажника это не касается: он урок проводит.
  if (employee.role === 'salesperson') return false;

  const pending = await pendingBooking(employee);
  if (!pending) return false;

  const timeZone = (await companyOf(employee.company_id))?.timezone ?? 'Asia/Almaty';

  await notify();
  await show(
    screen,
    `🎓 <b>${escapeHtml(pending.name)}</b> — запись на урок не закончена.\n` +
      'Пока у урока нет времени, продажник о клиенте не знает. Выберите день:',
    bookingDayButtons(pending.id, timeZone),
  );
  return true;
}

/**
 * Отмена записи: «Пробный» нажали случайно.
 *
 * Черновик удаляем, клиента возвращаем в прежний статус. Назначенный урок так
 * не отменить — у него уже есть время и продажник, которого предупредили;
 * такое правится в кабинете, чтобы отмена не проходила незаметно для него.
 */
async function cancelBooking(
  query: TelegramCallbackQuery,
  screen: Screen,
  employee: Employee,
  trialId: string,
  back?: string,
) {
  const supabase = createAdminSupabase();

  const { data: trial } = await supabase
    .from('trials')
    .select('id, lead_id, starts_at')
    .eq('id', trialId)
    .eq('company_id', employee.company_id)
    .maybeSingle();

  if (!trial) return answerCallback(query.id, 'Запись не найдена.');
  if (trial.starts_at) {
    return answerCallback(query.id, 'Урок уже назначен — отмените его в кабинете.');
  }

  const lead = trial.lead_id ? await ownLead(employee, trial.lead_id) : null;
  if (!lead) return answerCallback(query.id, 'Этот клиент уже не за вами.');

  await supabase
    .from('trials')
    .delete()
    .eq('id', trial.id)
    .eq('company_id', employee.company_id);

  const status: LeadStatus =
    back && isLeadStatus(back) && back !== 'trial' ? back : 'new';

  await supabase
    .from('leads')
    .update({ status })
    .eq('id', lead.id)
    .eq('company_id', employee.company_id);

  const company = await companyOf(employee.company_id);
  const label = leadStatusFor(status, company?.trial_term).label;

  await answerCallback(query.id, 'Запись отменена');
  await show(
    screen,
    `↩️ <b>${escapeHtml(lead.name || 'Клиент')}</b> — записи на урок нет, клиент снова в «${label}».`,
  );

  return listLeads({ chatId: screen.chatId }, employee, 'new');
}

// -----------------------------------------------------------------------------
// Запись на урок: день → час → продажник
// -----------------------------------------------------------------------------

/** Шаг 1: выбран день. Запоминаем дату и спрашиваем час. */
async function pickDay(
  query: TelegramCallbackQuery,
  screen: Screen,
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
  const { slots, hasSellers } = await daySlots(
    supabase,
    employee.company_id,
    date,
    timeZone,
    { exceptTrialId: trialId, after },
  );

  if (!hasSellers) {
    await answerCallback(query.id, 'Некому проводить урок');
    return show(
      screen,
      'В компании нет продажников — урок пока не на кого записать. Скажите директору.',
    );
  }

  // Сегодня после восьми вечера свободных часов не остаётся вовсе: сетка
  // кончилась, и замки тут ни при чём — предлагаем другой день.
  if (slots.length === 0 || slots.every((slot) => !slot.free)) {
    await answerCallback(query.id, 'Свободных часов нет');
    return show(
      screen,
      `🌙 На ${formatDay(date)} свободного времени не осталось.\nВыберите другой день:`,
      bookingDayButtons(trialId, timeZone),
    );
  }

  const { error } = await supabase
    .from('trials')
    .update({ date })
    .eq('id', trialId)
    .eq('company_id', employee.company_id);

  if (error) return answerCallback(query.id, 'Не удалось сохранить день.');

  await answerCallback(query.id, date);
  return show(
    screen,
    `📅 <b>${formatDay(date)}</b>\nСвободное время — выберите, что подходит клиенту:`,
    bookingTimeButtons(trialId, slots),
  );
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

/**
 * Шаг 2: выбран час. Дальше всё делает система — выбирает продажника из
 * свободных по очереди, закрепляет урок и предупреждает его.
 *
 * Менеджер в этот момент разговаривает с клиентом: ему нужен готовый ответ
 * «записал, урок проведёт такой-то», а не ещё один список на выбор.
 */
async function pickTime(
  query: TelegramCallbackQuery,
  screen: Screen,
  employee: Employee,
  trialId: string,
  hhmm: string,
) {
  const time = `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
  // Кнопка из старой сетки — например, с получасом, которого больше нет.
  // Отвечаем не ошибкой, а свежим списком дней: менеджер на линии с клиентом.
  if (!BOOKING_HOURS.includes(time)) {
    const zone = (await companyOf(employee.company_id))?.timezone ?? 'Asia/Almaty';
    await answerCallback(query.id, 'Это время больше не предлагается');
    return show(screen, '🕒 Выберите день заново:', bookingDayButtons(trialId, zone));
  }

  const supabase = createAdminSupabase();
  const company = await companyOf(employee.company_id);
  const timeZone = company?.timezone ?? 'Asia/Almaty';

  const { data: trial } = await supabase
    .from('trials')
    .select('id, date, lead_id')
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
    return show(screen, '⏰ Это время уже прошло. Выберите день заново.',
      bookingDayButtons(trialId, timeZone));
  }

  const seller = await pickSellerForTrial(
    supabase,
    employee.company_id,
    startsAt,
    trial.id,
  );

  // Пока менеджер выбирал, час мог занять другой менеджер. Сетку показываем
  // заново — уже с новым замком на этом часе.
  if (!seller) {
    const { slots } = await daySlots(supabase, employee.company_id, trial.date, timeZone, {
      exceptTrialId: trial.id,
    });

    await answerCallback(query.id, 'Это время уже заняли');
    return show(
      screen,
      `⏰ Пока выбирали, ${time} заняли. Свободное время на ${formatDay(trial.date)}:`,
      slots.some((slot) => slot.free)
        ? bookingTimeButtons(trial.id, slots)
        : bookingDayButtons(trial.id, timeZone),
    );
  }

  await supabase
    .from('trials')
    .update({
      starts_at: startsAt.toISOString(),
      assigned_to: seller.id,
      assigned_at: new Date().toISOString(),
    })
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

  // Запись урока — итог целой цепочки нажатий, и он остаётся в чате
  // отдельной строкой: менеджеру потом важно видеть, что и на когда записано.
  await show(
    screen,
    `✅ Урок записан: ${formatTrialTime(startsAt, timeZone)}, проводит ${escapeHtml(seller.fullName)}.\n${note}`,
  );

  return listLeads({ chatId: screen.chatId }, employee, 'new');
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
