import { NextResponse } from 'next/server';

import { LEAD_STATUS, isLeadStatus, type LeadStatus } from '@/lib/lead-status';
import { TRIAL_STATUS, isTrialStatus } from '@/lib/trial-status';
import {
  formatSchedule,
  resolveShiftRules,
  weekdayInZone,
  type ShiftRules,
} from '@/lib/attendance';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { runDistribution } from '@/lib/lead-distribution';
import { instantInZone } from '@/lib/lead-touches';
import { closeOpenTouches } from '@/lib/touch-runner';
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
  bookingDayButtons,
  bookingTimeButtons,
  bookingSellerButtons,
  qualityButtons,
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

const KEYBOARD_OFF = [['🟢 Я на смене'], ['📋 Мои лиды', '📵 Недозвон']];
const KEYBOARD_ON = [['🔴 Я ухожу'], ['📋 Мои лиды', '📵 Недозвон']];

/** Какую пачку показываем: новых или тех, до кого не дозвонились. */
type QueueMode = 'new' | 'no_answer';
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
  // Продажник только что отметил покупку — ждём сумму следующим сообщением.
  if (employee.awaiting_amount_for) {
    return saveSaleAmount(chatId, employee, text);
  }

  if (text.includes('Недозвон')) return listLeads(chatId, employee, 0, 'no_answer');
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
  max_touches: number;
  currency: string;
};

async function companyOf(companyId: string): Promise<CompanyRow | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('companies')
    .select(
      'shift_mode, office_lat, office_lng, office_radius_m, timezone, work_start_time, work_end_time, work_days, late_grace_minutes, funnel_type, max_touches, currency',
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

/**
 * Очередь клиентов: по одному за раз.
 *
 * Раньше бот вываливал в чат все заявки подряд — работать с этим невозможно,
 * менеджер тонет в ленте и теряет место. Теперь один клиент — одна карточка,
 * а дальше кнопка «Следующий». Порядок — по обещаниям: сначала тот, кому
 * обещали перезвонить раньше всех.
 */
async function listLeads(
  chatId: number,
  employee: Employee,
  offset = 0,
  mode: QueueMode = 'new',
) {
  const supabase = createAdminSupabase();

  // Заявки — рабочая информация, и выдаются они только на смене. Иначе бот
  // отдаёт номера человеку, который не работает, и никто не знает, звонит он
  // или нет.
  const company = await companyOf(employee.company_id);
  const needsShift = company
    ? resolveShiftRules(employee, company).mode !== 'always'
    : true;

  if (needsShift && !(await openShiftOf(employee.id))) {
    return sendMessage(
      chatId,
      'Сначала откройте смену — кнопка «Я на смене» ниже.\nЗаявки выдаются только тем, кто на работе.',
      { keyboard: KEYBOARD_OFF },
    );
  }

  // Обработанный клиент в очередь не возвращается: менеджер идёт по списку
  // один раз и не встречает одних и тех же людей по кругу. Недозвоны лежат
  // отдельной пачкой — к ним возвращаются, когда основная очередь пуста.
  const statuses = mode === 'new' ? (['new'] as const) : (['no_answer'] as const);

  const { data: leads, count } = await supabase
    .from('leads')
    .select('id, name, phone, source, platform, status, creative_id', { count: 'exact' })
    .eq('company_id', employee.company_id)
    .eq('assigned_to', employee.id)
    .in('status', statuses)
    .order('created_at', { ascending: true })
    .range(offset, offset);

  const total = count ?? 0;

  if (total === 0) {
    const empty =
      mode === 'new'
        ? 'Новых клиентов нет. Как появятся — пришлю сюда.\nНедозвоны — кнопка «📵 Недозвон».'
        : 'Недозвонов нет.';
    return sendMessage(chatId, empty, { keyboard: KEYBOARD_ON });
  }

  const lead = leads?.[0];
  if (!lead) {
    return sendMessage(chatId, 'Это был последний клиент в очереди.', {
      keyboard: KEYBOARD_ON,
    });
  }

  const funnelType = company?.funnel_type === 'direct' ? 'direct' : 'trial';
  const creativeName = await shortCreativeLabel(supabase, employee.company_id, lead.creative_id);

  const header =
    mode === 'new'
      ? `👤 <b>Клиент ${offset + 1} из ${total}</b>`
      : `📵 <b>Недозвон ${offset + 1} из ${total}</b>`;

  const next: InlineButton[][] =
    offset + 1 < total
      ? [[{ text: '➡️ Следующий клиент', callback_data: `nx:${offset + 1}:${mode}` }]]
      : [];

  return sendMessage(
    chatId,
    leadCard({ ...lead, creativeLabel: creativeName }, header),
    {
      inline: [
        ...statusButtons(lead.id, funnelType),
        ...next,
      ],
    },
  );
}

async function handleCallback(query: TelegramCallbackQuery) {
  const userId = query.from?.id;
  const chatId = query.message?.chat.id;
  if (!userId || !chatId) return;

  const employee = await findEmployee(userId);
  if (!employee) return answerCallback(query.id, 'Вы не подключены к платформе.');

  const [kind, leadId, value] = (query.data ?? '').split(':');
  if (!leadId) return answerCallback(query.id);

  // «Следующий клиент»: во втором поле не лид, а место в очереди, третьего нет.
  if (kind === 'nx') {
    await answerCallback(query.id);
    const mode: QueueMode = value === 'no_answer' ? 'no_answer' : 'new';
    return listLeads(chatId, employee, Number(leadId) || 0, mode);
  }

  if (!value) return answerCallback(query.id);

  if (kind === 's') return applyStatus(query, chatId, employee, leadId, value);
  if (kind === 'bd') return pickDay(query, chatId, employee, leadId, value);
  if (kind === 'bt') return pickTime(query, chatId, employee, leadId, value);
  if (kind === 'bs') return pickSeller(query, chatId, employee, leadId, value);
  if (kind === 'tr') return applyTrial(query, chatId, employee, leadId, value);
  if (kind === 'q') return applyQuality(query, chatId, employee, leadId, value);

  return answerCallback(query.id);
}

/**
 * Исход пробного занятия, отмеченный продажником.
 *
 * Продажник ведёт своё занятие, а не чужой лид, поэтому право проверяем по
 * записи на пробное: занятие должно быть закреплено именно за ним.
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

  const { data: lead } = trial.lead_id
    ? await supabase.from('leads').select('name').eq('id', trial.lead_id).maybeSingle()
    : { data: null };

  const name = escapeHtml(lead?.name || 'Клиент');

  if (!isTrialStatus(outcome) || outcome === 'scheduled') {
    return answerCallback(query.id, 'Неизвестный исход урока.');
  }

  await supabase.from('trials').update({ status: outcome }).eq('id', trial.id);

  // Купил курс — двигаем и лид: продажа считается по нему, и от него же
  // уходит событие в Meta.
  if (outcome === 'sale' && trial.lead_id) {
    await supabase
      .from('leads')
      .update({ status: 'sale' })
      .eq('id', trial.lead_id)
      .eq('company_id', employee.company_id);

    // Сумму спрашиваем сразу: без неё продажа не попадёт ни в выручку, ни в
    // Meta, а возвращаться за ней потом никто не будет.
    await supabase
      .from('employees')
      .update({ awaiting_amount_for: trial.id })
      .eq('id', employee.id);

    await answerCallback(query.id, 'Продажа отмечена');
    return sendMessage(
      chatId,
      `💰 <b>${name}</b> купил курс.\nНа какую сумму? Отправьте число одним сообщением — например <code>390000</code>.`,
    );
  }

  // Не одобрил — урок отработан, покупки не будет: лид закрываем отказом,
  // иначе он навсегда останется висеть на шаге «Пробный».
  if (outcome === 'rejected' && trial.lead_id) {
    await supabase
      .from('leads')
      .update({ status: 'rejected' })
      .eq('id', trial.lead_id)
      .eq('company_id', employee.company_id);

    await closeOpenTouches(supabase, trial.lead_id);
  }

  const label = TRIAL_STATUS[outcome].label;
  await answerCallback(query.id, label);
  return sendMessage(chatId, `✅ <b>${name}</b> — ${label.toLowerCase()}.`);
}


/**
 * Смена статуса лида из чата.
 *
 * После любой отметки бот сразу даёт следующего клиента: менеджер работает
 * очередью, а не листает ленту. Тронутый лид уходит в конец очереди сам —
 * порядок держится на времени последнего изменения.
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

  const label = LEAD_STATUS[status].label;
  await answerCallback(query.id, `Статус: ${label}`);
  await closeOpenTouches(supabase, lead.id);

  const company = await companyOf(employee.company_id);

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
        `🎓 <b>${escapeHtml(lead.name || 'Клиент')}</b> — записываем на урок.\nНа какой день?`,
        { inline: bookingDayButtons(trialId) },
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

  await sendMessage(chatId, `✅ <b>${escapeHtml(lead.name || 'Клиент')}</b> → ${label}`);
  return listLeads(chatId, employee);
}

/**
 * Сумма продажи курса, присланная продажником.
 *
 * Продажа заводится здесь же и сразу оплаченной: продажник называет сумму
 * только после того, как деньги пришли. Отсюда же событие уходит в Meta —
 * иначе реклама не узнает о покупке, ради которой всё и делалось.
 */
async function saveSaleAmount(chatId: number, employee: Employee, text: string) {
  const supabase = createAdminSupabase();
  const trialId = employee.awaiting_amount_for;
  if (!trialId) return;

  const clear = () =>
    supabase.from('employees').update({ awaiting_amount_for: null }).eq('id', employee.id);

  if (/отмен/i.test(text)) {
    await clear();
    return sendMessage(chatId, 'Хорошо, сумму не записываем.', { keyboard: KEYBOARD_ON });
  }

  // Пробелы и разделители внутри числа люди ставят по-разному.
  const amount = Number(text.replace(/[^\d.,]/g, '').replace(',', '.'));

  if (!Number.isFinite(amount) || amount <= 0) {
    return sendMessage(
      chatId,
      'Не понял сумму. Пришлите число, например <code>390000</code>, или напишите «отмена».',
    );
  }

  const { data: trial } = await supabase
    .from('trials')
    .select('id, lead_id')
    .eq('id', trialId)
    .eq('company_id', employee.company_id)
    .maybeSingle();

  if (!trial) {
    await clear();
    return sendMessage(chatId, 'Запись урока не найдена.');
  }

  const company = await companyOf(employee.company_id);

  const { data: sale } = await supabase
    .from('sales')
    .insert({
      company_id: employee.company_id,
      lead_id: trial.lead_id,
      amount,
      status: 'paid',
      sale_date: localDate(company?.timezone ?? 'Asia/Almaty'),
    })
    .select('id')
    .maybeSingle();

  await clear();

  if (!sale) return sendMessage(chatId, 'Не удалось сохранить продажу. Скажите директору.');

  // В Meta событие отсюда не уходит: сначала продажник оценивает клиента, а
  // отправляет его таргетолог. Обучать рекламу на случайном покупателе значит
  // просить её искать таких же.
  return sendMessage(
    chatId,
    `✅ Продажа записана: <b>${formatAmount(amount)} ${company?.currency ?? 'KZT'}</b>.\n\nКакой это клиент? От этого зависит, отправлять ли покупку в рекламный кабинет.`,
    { inline: qualityButtons(trial.lead_id) },
  );
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

  const day = new Date(Date.now() + (Number(offset) || 0) * 24 * 60 * 60 * 1000);
  const date = localDate(timeZone, day);

  const { error } = await supabase
    .from('trials')
    .update({ date })
    .eq('id', trialId)
    .eq('company_id', employee.company_id);

  if (error) return answerCallback(query.id, 'Не удалось сохранить день.');

  await answerCallback(query.id, date);
  return sendMessage(chatId, `📅 ${date}. Во сколько урок?`, {
    inline: bookingTimeButtons(trialId),
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

  return listLeads(chatId, employee);
}

type OwnLead = { id: string; name: string; touch_count: number };

/** Сотрудник двигает только свои лиды и только внутри своей компании. */
async function ownLead(employee: Employee, leadId: string): Promise<OwnLead | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('leads')
    .select('id, name, touch_count')
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
};

async function findEmployee(telegramUserId: number): Promise<Employee | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('employees')
    .select(
      'id, company_id, full_name, role, shift_mode, work_start_time, work_end_time, work_days, late_grace_minutes, awaiting_amount_for',
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
