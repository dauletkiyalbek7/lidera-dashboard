import { NextResponse } from 'next/server';

import { LEAD_STATUS, isLeadStatus, leadStatusesFor, type LeadStatus } from '@/lib/lead-status';
import { createAdminSupabase, isAdminConfigured } from '@/lib/supabase/admin';
import {
  answerCallback,
  isBotConfigured,
  sendMessage,
  webhookSecret,
  type InlineButton,
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

  if (text.includes('на смене')) return openShift(chatId, employee);
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

async function openShift(chatId: number, employee: Employee) {
  const supabase = createAdminSupabase();

  if (await openShiftOf(employee.id)) {
    return sendMessage(chatId, 'Смена уже открыта.', { keyboard: KEYBOARD_ON });
  }

  const { error } = await supabase.from('shifts').insert({
    company_id: employee.company_id,
    employee_id: employee.id,
    source: 'telegram',
  });

  if (error) return sendMessage(chatId, 'Не удалось открыть смену, попробуйте ещё раз.');

  const active = await countActiveLeads(employee.id);
  return sendMessage(
    chatId,
    `Смена открыта. Хорошей работы!\n\nВ работе сейчас: <b>${active}</b> ${plural(active, 'лид', 'лида', 'лидов')}.`,
    { keyboard: KEYBOARD_ON },
  );
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

function leadCard(lead: {
  name: string;
  phone: string | null;
  source: string | null;
  platform: string | null;
  status: string;
}): string {
  const rows = [
    `<b>${escapeHtml(lead.name || 'Без имени')}</b>`,
    lead.phone ? `📞 ${escapeHtml(lead.phone)}` : null,
    lead.platform || lead.source
      ? `Источник: ${escapeHtml(lead.platform ?? lead.source ?? '')}`
      : null,
    `Статус: ${LEAD_STATUS[lead.status as LeadStatus]?.label ?? lead.status}`,
  ];
  return rows.filter(Boolean).join('\n');
}

/** Кнопки статусов: «новый» не предлагаем — назад по воронке лид не двигают. */
function statusButtons(leadId: string, funnelType: 'trial' | 'direct'): InlineButton[][] {
  const statuses = leadStatusesFor(funnelType).filter((status) => status !== 'new');
  const buttons = statuses.map((status) => ({
    text: LEAD_STATUS[status].label,
    callback_data: `s:${leadId}:${status}`,
  }));

  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
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

type Employee = { id: string; company_id: string; full_name: string; role: string };

async function findEmployee(telegramUserId: number): Promise<Employee | null> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('employees')
    .select('id, company_id, full_name, role')
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
};

type TelegramCallbackQuery = {
  id: string;
  from?: { id: number };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
};
