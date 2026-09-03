import type { Metadata } from 'next';
import Link from 'next/link';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconChain } from '@/components/ui/icons';
import { requireCompanySession } from '@/lib/auth';
import { formatDateTime, formatTime } from '@/lib/format';
import { getInbox, type Conversation, type Thread } from '@/lib/inbox-queries';
import { leadStatusFor } from '@/lib/lead-status';
import { ReplyForm } from './reply-form';

/**
 * «Переписки» — рабочее место для разговора с клиентом.
 *
 * Номер, отданный в Cloud API, в приложении WhatsApp больше не открывается,
 * поэтому этот раздел не удобство, а единственный способ ответить человеку.
 * Устройство привычное: слева люди, справа разговор — менеджер ведёт десяток
 * клиентов сразу и не должен держать в голове, кому что уже написал.
 */

export const metadata: Metadata = { title: 'Переписки' };
export const dynamic = 'force-dynamic';

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lead?: string }>;
}) {
  const { company, employee } = await requireCompanySession();
  const { q, lead } = await searchParams;

  const { conversations, thread, hasNumber } = await getInbox(company.id, {
    query: q,
    leadId: lead,
    employeeId: employee?.id ?? null,
  });

  return (
    <>
      <PageHeader
        title="Переписки"
        description="Клиенты, написавшие в WhatsApp. Отвечать можно в течение суток с их последнего сообщения — так требует Meta."
      />

      <PageBody>
        {!hasNumber ? (
          <Card>
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconChain className="size-5" />}
                title="Номер не подключён"
                description="Переписки появятся, когда в разделе «WhatsApp» заработает приём сообщений."
              />
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="grid lg:grid-cols-[320px_1fr]">
              <aside className="border-b border-line lg:border-b-0 lg:border-r">
                <SearchForm defaultValue={q ?? ''} />
                <List
                  conversations={conversations}
                  activeId={thread?.leadId ?? null}
                  query={q}
                  timeZone={company.timezone}
                />
              </aside>

              <section className="min-w-0">
                {thread ? (
                  <ThreadView thread={thread} timeZone={company.timezone} />
                ) : (
                  <div className="p-6">
                    <EmptyState
                      icon={<IconChain className="size-5" />}
                      title={q ? 'Никого не нашлось' : 'Переписок пока нет'}
                      description={
                        q
                          ? 'Попробуйте имя или последние цифры номера.'
                          : 'Как только клиент напишет на номер, разговор появится здесь.'
                      }
                    />
                  </div>
                )}
              </section>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}

/** Поиск обычной формой: адрес с запросом можно переслать и сохранить. */
function SearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <form className="border-b border-line p-3">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Имя или номер"
        className="h-10 w-full rounded-control border border-line bg-surface-2 px-3 text-[14px] text-ink placeholder:text-faint focus:border-lime/50 focus:outline-none"
      />
    </form>
  );
}

function List({
  conversations,
  activeId,
  query,
  timeZone,
}: {
  conversations: Conversation[];
  activeId: string | null;
  query?: string;
  timeZone: string;
}) {
  if (conversations.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-faint">Никого не нашлось.</p>;
  }

  return (
    <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">
      {conversations.map((item) => {
        const status = leadStatusFor(item.status, undefined);
        const active = item.leadId === activeId;

        return (
          <li key={item.leadId}>
            <Link
              href={{ pathname: '/dashboard/inbox', query: { lead: item.leadId, ...(query ? { q: query } : {}) } }}
              className={`block px-4 py-3 transition-colors ${active ? 'bg-surface-3' : 'hover:bg-surface-2'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[14px] font-medium text-ink">{item.name}</span>
                <span className="tabular shrink-0 text-[11.5px] text-faint">
                  {item.lastAt ? formatTime(item.lastAt, timeZone) : ''}
                </span>
              </div>

              <p className="mt-0.5 truncate text-[13px] text-muted">{item.preview}</p>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={status.tone}>{status.label}</Badge>
                {item.unanswered > 0 ? (
                  <Badge tone="lime">Ждёт ответа: {item.unanswered}</Badge>
                ) : null}
                {!item.windowOpen ? <Badge tone="neutral">Окно закрыто</Badge> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ThreadView({ thread, timeZone }: { thread: Thread; timeZone: string }) {
  const status = leadStatusFor(thread.status, undefined);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">{thread.name}</p>
          {thread.phone ? (
            <p className="tabular mt-0.5 text-[13px] text-muted">{thread.phone}</p>
          ) : null}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      <div className="flex max-h-[480px] min-h-64 flex-col gap-2 overflow-y-auto p-4 sm:p-5">
        {thread.messages.length === 0 ? (
          <p className="text-[13px] text-faint">Сообщений пока нет.</p>
        ) : (
          thread.messages.map((message) => (
            <Bubble key={message.id} message={message} timeZone={timeZone} />
          ))
        )}
      </div>

      {thread.windowOpen ? (
        <ReplyForm leadId={thread.leadId} />
      ) : (
        <div className="border-t border-line bg-surface-2 px-4 py-3.5 sm:px-5">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            С последнего сообщения клиента прошло больше суток.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-faint">
            Meta разрешает писать свободным текстом только 24 часа. Дальше —
            лишь заранее утверждённым шаблоном. Дождитесь, пока человек напишет
            сам, или позвоните ему.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Сообщение в переписке. Входящие слева, наши справа — как в мессенджере, из
 * которого этот номер как раз и нельзя открыть.
 */
function Bubble({
  message,
  timeZone,
}: {
  message: Thread['messages'][number];
  timeZone: string;
}) {
  const own = message.direction === 'out';

  return (
    <div className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-panel px-3.5 py-2.5 ${
          own ? 'bg-lime/12 text-ink' : 'border border-line bg-surface-2 text-ink'
        }`}
      >
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
          {message.body?.trim() || attachmentLabel(message.type)}
        </p>

        <p className="tabular mt-1 text-[11px] text-faint">
          {formatDateTime(message.sentAt, timeZone)}
          {own ? ` · ${deliveryLabel(message.status)}` : ''}
        </p>

        {message.error ? (
          <p className="mt-1 text-[11.5px] leading-relaxed text-negative">{message.error}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Вложения пока не скачиваем: файл лежит у Meta и доступен по временной
 * ссылке. Показываем хотя бы вид сообщения, чтобы в переписке не было дырок.
 */
function attachmentLabel(type: string): string {
  const named: Record<string, string> = {
    image: '📷 Фото — пока не показываем',
    audio: '🎤 Голосовое — пока не показываем',
    video: '🎬 Видео — пока не показываем',
    document: '📎 Файл — пока не показываем',
    sticker: '🙂 Стикер',
    location: '📍 Геолокация',
  };
  return named[type] ?? 'Вложение';
}

function deliveryLabel(status: string): string {
  const named: Record<string, string> = {
    sent: 'отправлено',
    delivered: 'доставлено',
    read: 'прочитано',
    failed: 'не отправлено',
  };
  return named[status] ?? status;
}
