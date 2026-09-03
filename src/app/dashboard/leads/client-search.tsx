import { Badge, StatusDot } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconLeads } from '@/components/ui/icons';
import { formatDate, formatDateTime, formatMoney, formatTime } from '@/lib/format';
import { leadStatusFor } from '@/lib/lead-status';
import { SEARCH_LIMIT, type ClientMatch } from '@/lib/queries';
import type { ReactNode } from 'react';
import { trialStatusMeta } from '@/lib/trial-status';
import { trialWords } from '@/lib/trial-term';

/** Поле поиска. Обычная форма на GET: ссылку с результатом можно переслать. */
export function ClientSearchForm({ query }: { query: string }) {
  return (
    <form action="/dashboard/leads" method="get" className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Номер телефона или имя"
        aria-label="Найти клиента по номеру телефона или имени"
        className="h-11 w-full min-w-0 rounded-control border border-line bg-surface-2 px-3.5 text-[14.5px] text-ink placeholder:text-faint focus:border-lime/50 focus:outline-none sm:w-[280px]"
      />
      <button
        type="submit"
        className="h-11 shrink-0 rounded-control bg-lime px-4 text-[14px] font-medium text-ink-inverse transition-opacity hover:opacity-90"
      >
        Найти
      </button>
    </form>
  );
}

/**
 * Результат поиска клиента.
 *
 * Показывается вместо списка за период: когда ищут конкретного человека,
 * список остальных заявок только мешает. Каждая карточка — вся история
 * клиента, чтобы менеджер поднял трубку уже зная, с кем говорит.
 */
export function ClientSearchResults({
  query,
  matches,
  trialTerm,
  currency,
  timeZone,
}: {
  query: string;
  matches: ClientMatch[];
  trialTerm: string;
  currency: string;
  /** Пояс проекта: время заявки должно совпадать с часами на телефоне. */
  timeZone: string;
}) {
  const words = trialWords(trialTerm);

  if (matches.length === 0) {
    return (
      <Card className="mt-4">
        <div className="p-5 sm:p-6">
          <EmptyState
            icon={<IconLeads className="size-5" />}
            title={`По запросу «${query}» никого не нашли`}
            description="Проверьте номер — достаточно любой его части, без пробелов и скобок. Искать можно и по имени."
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader
        title={`Найдено: ${matches.length}`}
        subtitle={
          // Упёрлись в предел — значит совпадений может быть и больше, и
          // молчать об этом нельзя: человек решит, что нужного клиента нет.
          matches.length === SEARCH_LIMIT
            ? `Показаны первые ${SEARCH_LIMIT}. Уточните запрос — по номеру находится точнее, чем по имени`
            : 'Поиск идёт по всей истории компании, а не за выбранный период'
        }
      />
      <div className="divide-y divide-line">
        {matches.map((match) => {
          const status = leadStatusFor(match.status, trialTerm);

          return (
            <div key={match.id} className="px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink">{match.name}</p>
                  {match.phone ? (
                    <a
                      href={`tel:${match.phone.replace(/[^\d+]/g, '')}`}
                      className="tabular mt-0.5 block text-[13.5px] text-lime"
                    >
                      {match.phone}
                    </a>
                  ) : (
                    <p className="mt-0.5 text-[13.5px] text-faint">Телефон не указан</p>
                  )}
                  {match.email ? (
                    <p className="mt-0.5 text-[12.5px] text-muted">{match.email}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Badge tone={status.tone}>
                    <StatusDot tone={status.tone} />
                    {status.label}
                  </Badge>
                  {match.totalPaid > 0 ? (
                    <span className="tabular text-[13.5px] font-medium text-positive">
                      Заплатил {formatMoney(match.totalPaid, { currency })}
                    </span>
                  ) : null}
                </div>
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Пришёл" value={formatDateTime(match.createdAt, timeZone)} />
                <Fact
                  label="Источник"
                  value={[match.platform, match.source].filter(Boolean).join(' · ') || null}
                />
                <Fact
                  label="Объявление"
                  value={
                    match.creativeName
                      ? match.clickCount > 1
                        ? `${match.creativeName} · переходов ${match.clickCount}`
                        : match.creativeName
                      : null
                  }
                />
                <Fact label="Ответственный" value={match.assignedName} />
                {match.departmentName ? (
                  <Fact label="Отдел" value={match.departmentName} />
                ) : null}
                <Fact
                  label="Касаний"
                  value={
                    match.touchCount
                      ? `${match.touchCount}${
                          match.lastTouchAt
                            ? `, последнее ${formatDate(match.lastTouchAt, timeZone)}`
                            : ''
                        }`
                      : null
                  }
                />
                {match.nextTouchAt ? (
                  <Fact label="Обещал перезвонить" value={formatDateTime(match.nextTouchAt, timeZone)} />
                ) : null}
              </dl>

              {match.messages.length > 0 ? (
                <Conversation messages={match.messages} timeZone={timeZone} />
              ) : null}

              {match.visits.length > 0 ? (
                <History title={words.section}>
                  {match.visits.map((visit) => {
                    const meta = trialStatusMeta(visit.status);
                    return (
                      <li key={visit.id} className="flex flex-wrap items-center gap-2">
                        <span className="tabular text-[12.5px] text-muted">
                          {formatDate(visit.date)}
                        </span>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {visit.sellerName ? (
                          <span className="text-[12.5px] text-faint">{visit.sellerName}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </History>
              ) : null}

              {match.purchases.length > 0 ? (
                <History title="Покупки">
                  {match.purchases.map((purchase) => (
                    <li key={purchase.id} className="flex flex-wrap items-center gap-2">
                      <span className="tabular text-[12.5px] text-muted">
                        {formatDate(purchase.date)}
                      </span>
                      <span className="tabular text-[13px] font-medium text-ink">
                        {formatMoney(purchase.amount, { currency })}
                      </span>
                      {purchase.product ? (
                        <span className="text-[12.5px] text-ink-soft">{purchase.product}</span>
                      ) : null}
                      {purchase.status !== 'paid' ? (
                        <Badge tone={purchase.status === 'refunded' ? 'negative' : 'neutral'}>
                          {purchase.status === 'refunded' ? 'Возврат' : 'Не оплачено'}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </History>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * Переписка WhatsApp.
 *
 * Отвечать отсюда нельзя — менеджеры ведут разговор у себя. Смысл в другом:
 * поднять трубку, уже зная, о чём человек спрашивал. Свежие сообщения снизу,
 * как в любом мессенджере.
 */
function Conversation({
  messages,
  timeZone,
}: {
  messages: ClientMatch['messages'];
  timeZone: string;
}) {
  return (
    <div className="mt-4 rounded-panel border border-line bg-surface-2 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
        Переписка WhatsApp
      </p>
      <ol className="mt-3 space-y-2">
        {messages.map((message) => {
          const outgoing = message.direction === 'out';

          return (
            <li
              key={message.id}
              className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-panel px-3 py-2 ${
                  outgoing
                    ? 'bg-lime/12 text-ink-soft'
                    : 'border border-line bg-surface text-ink'
                }`}
              >
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                  {message.body ?? '—'}
                </p>
                <p className="tabular mt-1 text-[11px] text-faint">
                  {outgoing ? 'Автоответ · ' : ''}
                  {formatTime(message.sentAt, timeZone)}
                  {message.status === 'failed' ? ' · не доставлено' : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Одна строка «подпись — значение». Пустые значения не показываем вовсе. */
function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] text-ink-soft">{value}</dd>
    </div>
  );
}

function History({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-panel border border-line bg-surface-2 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
        {title}
      </p>
      <ul className="mt-2 space-y-1.5">{children}</ul>
    </div>
  );
}
