import 'server-only';

import { REPLY_WINDOW_MS } from '@/lib/whatsapp';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Данные раздела «Переписки».
 *
 * Номер, отданный в Cloud API, перестаёт открываться в приложении WhatsApp —
 * ни в обычном, ни в бизнес-версии. Значит единственное место, где живёт
 * переписка с клиентом, это платформа, и раздел обязан заменить собой
 * мессенджер целиком: список слева, разговор справа, поиск и ответ.
 */

/** Сколько последних сообщений показываем в разговоре. */
const THREAD_LIMIT = 200;

/** Сколько разговоров в списке. Больше человек всё равно не пролистывает. */
const LIST_LIMIT = 60;

export type Conversation = {
  leadId: string;
  name: string;
  phone: string | null;
  status: string;
  /** Последнее сообщение — что именно и когда. */
  preview: string;
  lastAt: string | null;
  /** Входящие после нашего последнего ответа: сколько человек ждёт. */
  unanswered: number;
  /** Можно ли писать свободным текстом: у Meta на это ровно сутки. */
  windowOpen: boolean;
  numberId: string;
};

export type ThreadMessage = {
  id: string;
  direction: 'in' | 'out';
  type: string;
  body: string | null;
  status: string;
  error: string | null;
  sentAt: string;
};

export type Thread = {
  leadId: string;
  name: string;
  phone: string | null;
  status: string;
  numberId: string;
  messages: ThreadMessage[];
  windowOpen: boolean;
  /** Когда закроется окно ответа — показываем, сколько времени осталось. */
  windowClosesAt: string | null;
};

export type Inbox = {
  conversations: Conversation[];
  thread: Thread | null;
  /** Есть ли вообще подключённый номер: без него отвечать нечем. */
  hasNumber: boolean;
};

export async function getInbox(
  companyId: string,
  options: { query?: string; leadId?: string; employeeId?: string | null },
): Promise<Inbox> {
  const supabase = await createServerSupabase();

  const { count: numbers } = await supabase
    .from('whatsapp_numbers')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'connected');

  let leadsQuery = supabase
    .from('leads')
    .select('id, name, phone, status, whatsapp_number_id, last_inbound_at')
    .eq('company_id', companyId)
    .not('whatsapp_number_id', 'is', null)
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .limit(LIST_LIMIT);

  // Сотрудник видит только своих клиентов: чужая переписка — не его работа,
  // а телефоны чужих клиентов ему и вовсе не нужны.
  if (options.employeeId) leadsQuery = leadsQuery.eq('assigned_to', options.employeeId);

  // Поиск идёт по человеку, а не по тексту: менеджер ищет «кто это был»,
  // держа в голове имя или последние цифры номера.
  const query = options.query?.trim();
  if (query) {
    const digits = query.replace(/\D/g, '');
    const escaped = escapeFilterValue(query);
    leadsQuery = digits
      ? leadsQuery.or(`name.ilike.%${escaped}%,phone_digits.ilike.%${digits}%`)
      : leadsQuery.ilike('name', `%${escaped}%`);
  }

  const { data: leads } = await leadsQuery;
  const rows = leads ?? [];

  if (rows.length === 0) {
    return { conversations: [], thread: null, hasNumber: (numbers ?? 0) > 0 };
  }

  // Последние сообщения всех разговоров одним запросом: отдельный запрос на
  // каждого клиента превращает открытие раздела в шестьдесят обращений к базе.
  const { data: recent } = await supabase
    .from('whatsapp_messages')
    .select('lead_id, direction, type, body, sent_at')
    .eq('company_id', companyId)
    .in(
      'lead_id',
      rows.map((lead) => lead.id),
    )
    .order('sent_at', { ascending: false })
    .limit(1000);

  const byLead = new Map<string, typeof recent>();
  for (const message of recent ?? []) {
    if (!message.lead_id) continue;
    const list = byLead.get(message.lead_id) ?? [];
    list.push(message);
    byLead.set(message.lead_id, list);
  }

  const now = Date.now();

  const conversations: Conversation[] = rows.map((lead) => {
    const messages = byLead.get(lead.id) ?? [];
    const last = messages[0];

    // Сообщения отсортированы от свежих к старым, поэтому «сколько ждёт
    // ответа» — это входящие до первого нашего исходящего.
    let unanswered = 0;
    for (const message of messages) {
      if (message.direction === 'out') break;
      unanswered += 1;
    }

    return {
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      preview: last ? previewOf(last.type, last.body) : 'Сообщений нет',
      lastAt: last?.sent_at ?? lead.last_inbound_at,
      unanswered,
      windowOpen: isWindowOpen(lead.last_inbound_at, now),
      numberId: lead.whatsapp_number_id as string,
    };
  });

  const selected = options.leadId
    ? conversations.find((item) => item.leadId === options.leadId)
    : conversations[0];

  const thread = selected ? await loadThread(companyId, selected) : null;

  return { conversations, thread, hasNumber: (numbers ?? 0) > 0 };
}

async function loadThread(companyId: string, item: Conversation): Promise<Thread> {
  const supabase = await createServerSupabase();

  const { data: messages } = await supabase
    .from('whatsapp_messages')
    .select('id, direction, type, body, status, error, sent_at')
    .eq('company_id', companyId)
    .eq('lead_id', item.leadId)
    .order('sent_at', { ascending: true })
    .limit(THREAD_LIMIT);

  const { data: lead } = await supabase
    .from('leads')
    .select('last_inbound_at')
    .eq('id', item.leadId)
    .maybeSingle();

  const closesAt = lead?.last_inbound_at
    ? new Date(new Date(lead.last_inbound_at).getTime() + REPLY_WINDOW_MS)
    : null;

  return {
    leadId: item.leadId,
    name: item.name,
    phone: item.phone,
    status: item.status,
    numberId: item.numberId,
    windowOpen: item.windowOpen,
    windowClosesAt: closesAt && closesAt.getTime() > Date.now() ? closesAt.toISOString() : null,
    messages: (messages ?? []).map((row) => ({
      id: row.id,
      direction: row.direction,
      type: row.type,
      body: row.body,
      status: row.status,
      error: row.error,
      sentAt: row.sent_at,
    })),
  };
}

/**
 * Правило Meta: свободным текстом клиенту можно писать только сутки с его
 * последнего сообщения. Дальше — лишь заранее утверждённые шаблоны.
 */
export function isWindowOpen(lastInboundAt: string | null, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  return now - new Date(lastInboundAt).getTime() < REPLY_WINDOW_MS;
}

/** Строка списка: у вложений текста нет, поэтому называем сам вид. */
function previewOf(type: string, body: string | null): string {
  if (body?.trim()) return body.trim();

  const named: Record<string, string> = {
    image: '📷 Фото',
    audio: '🎤 Голосовое',
    video: '🎬 Видео',
    document: '📎 Файл',
    sticker: '🙂 Стикер',
    location: '📍 Геолокация',
  };

  return named[type] ?? 'Вложение';
}

/**
 * Экранирование для фильтра PostgREST: запятые и скобки в нём разделяют
 * условия, и имя вроде «Иванов, Пётр» ломает разбор всего запроса.
 */
function escapeFilterValue(value: string): string {
  return value.replace(/[,()"\\]/g, ' ').trim();
}
