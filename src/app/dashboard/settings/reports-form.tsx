'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import {
  addReportSchedule,
  removeReportChat,
  removeReportSchedule,
  sendReportNowAction,
  type SettingsState,
} from './actions';

/** Периоды отчёта. Порядок — от короткого к длинному, как их и выбирают. */
const PERIODS = [
  { value: 'today', label: 'за сегодня' },
  { value: 'yesterday', label: 'за вчера' },
  { value: 'week', label: 'за 7 дней' },
  { value: 'month', label: 'за месяц' },
];

/** Блоки отчёта. По умолчанию — деньги и отделы: разбор по роликам смотрят в кабинете. */
const SECTIONS = [
  { value: 'ads', label: 'Расход и показатели рекламы', checked: true },
  { value: 'breakdown', label: 'Отделы', checked: true },
  { value: 'creatives', label: 'Ролики', checked: false },
  { value: 'leads', label: 'Заявки и статусы', checked: false },
  { value: 'sales', label: 'Продажи и выручка', checked: false },
];

export type ReportChat = { id: string; title: string | null; chatId: number };

export type ReportSchedule = {
  id: string;
  chatId: string;
  chatTitle: string;
  sendAt: string;
  period: string;
  sections: string[];
  sentToday: boolean;
};

/**
 * Отчёты в Telegram.
 *
 * Три вещи на одном экране: код для привязки группы, список привязанных групп
 * и времена отправки. Отдельного раздела в меню пока не заводим — настраивают
 * это один раз, а смотрят потом в самом чате.
 */
export function ReportsForm({
  code,
  chats,
  schedules,
  botName,
  disabled,
}: {
  code: string | null;
  chats: ReportChat[];
  schedules: ReportSchedule[];
  botName: string | null;
  disabled: boolean;
}) {
  return (
    <div className="space-y-5 px-5 py-5 sm:px-6">
      <ol className="space-y-2 text-[13.5px] leading-relaxed text-ink-soft">
        <li>
          1. Добавьте бота{botName ? ` @${botName}` : ''} в группу и дайте ему право
          писать сообщения.
        </li>
        <li>
          2. Отправьте в группе команду{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[13px] text-ink">
            /отчёт {code ?? '—'}
          </code>
          {' '}— бот ответит, что группа привязана к этому проекту.
        </li>
        <li>3. Ниже задайте время отправки. Отчёт придёт сам, по часам проекта.</li>
      </ol>

      {chats.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line px-4 py-4 text-[13px] text-muted">
          Пока ни одной группы. Сделайте первые два шага — она появится здесь.
        </p>
      ) : (
        <ul className="space-y-2">
          {chats.map((chat) => (
            <li
              key={chat.id}
              className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface-2/50 px-3.5 py-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] text-ink">
                  {chat.title || 'Группа без названия'}
                </span>
                <span className="tabular block text-[12px] text-faint">{chat.chatId}</span>
              </span>
              {disabled ? null : (
                <RowForm action={removeReportChat} id={chat.id} label="Отвязать" />
              )}
            </li>
          ))}
        </ul>
      )}

      {schedules.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[12.5px] text-muted">Расписание</p>
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-surface px-3.5 py-2.5"
            >
              <span className="min-w-0 text-[13.5px] text-ink">
                <span className="tabular font-medium">{schedule.sendAt.slice(0, 5)}</span>
                {' · '}
                {PERIODS.find((item) => item.value === schedule.period)?.label ?? schedule.period}
                {' · '}
                <span className="text-ink-soft">{schedule.chatTitle}</span>
                <span className="mt-0.5 block text-[12px] text-faint">
                  {schedule.sections
                    .map((key) => SECTIONS.find((item) => item.value === key)?.label ?? key)
                    .join(' · ')}
                  {schedule.sentToday ? ' · сегодня уже отправлен' : ''}
                </span>
              </span>
              {disabled ? null : (
                <span className="flex items-center gap-1.5">
                  <RowForm action={sendReportNowAction} id={schedule.id} label="Отправить сейчас" />
                  <RowForm action={removeReportSchedule} id={schedule.id} label="Удалить" />
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {disabled || chats.length === 0 ? null : (
        <AddForm chats={chats} />
      )}

      {disabled ? (
        <p className="text-[12.5px] text-faint">Расписание меняет директор компании.</p>
      ) : null}
    </div>
  );
}

function AddForm({ chats }: { chats: ReportChat[] }) {
  const [state, formAction] = useActionState(addReportSchedule, {} as SettingsState);

  return (
    <form action={formAction} className="space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="space-y-1">
          <span className="block text-[12.5px] text-muted">Время</span>
          <input
            type="time"
            name="sendAt"
            defaultValue="09:00"
            required
            className="h-10 rounded-control border border-line bg-surface-2 px-3 text-[13.5px] text-ink"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-[12.5px] text-muted">Период</span>
          <select
            name="period"
            defaultValue="yesterday"
            className="h-10 rounded-control border border-line bg-surface-2 px-3 text-[13.5px] text-ink"
          >
            {PERIODS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-[180px] flex-1 space-y-1">
          <span className="block text-[12.5px] text-muted">Группа</span>
          <select
            name="chatId"
            className="h-10 w-full rounded-control border border-line bg-surface-2 px-3 text-[13.5px] text-ink"
          >
            {chats.map((chat) => (
              <option key={chat.id} value={chat.id}>
                {chat.title || `Группа ${chat.chatId}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {SECTIONS.map((section) => (
          <label key={section.value} className="flex items-center gap-2 text-[13px] text-ink-soft">
            <input
              type="checkbox"
              name="sections"
              value={section.value}
              defaultChecked={section.checked}
              className="size-4 rounded border-line-strong bg-surface-2 accent-lime"
            />
            {section.label}
          </label>
        ))}
      </div>

      <FormMessage error={state.error} success={state.success} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Сохраняю…' : 'Добавить отправку'}
    </Button>
  );
}

/** Кнопка-действие в строке списка: одно поле и одна кнопка. */
function RowForm({
  action,
  id,
  label,
}: {
  action: (state: SettingsState, formData: FormData) => Promise<SettingsState>;
  id: string;
  label: string;
}) {
  const [, formAction] = useActionState(action, {} as SettingsState);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm">
        {label}
      </Button>
    </form>
  );
}
