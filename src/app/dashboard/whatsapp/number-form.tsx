'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { saveWhatsappNumber, type WhatsappState } from './actions';

export type NumberDefaults = {
  id: string;
  label: string;
  displayPhone: string | null;
  phoneNumberId: string;
  wabaId: string | null;
  departmentId: string | null;
  hasToken: boolean;
  hasAppSecret: boolean;
  autoReplyEnabled: boolean;
  autoReplyDay: string | null;
  autoReplyNight: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
};

/**
 * Подключение номера.
 *
 * Токен и секрет приложения показываются ровно один раз — в момент ввода.
 * Дальше поле пустое, а надпись под ним говорит, что значение сохранено. Так
 * его нельзя ни подсмотреть через плечо, ни вытащить из страницы.
 */
export function NumberForm({
  defaults,
  departments,
}: {
  defaults?: NumberDefaults;
  departments: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(saveWhatsappNumber, {} as WhatsappState);
  const [autoReply, setAutoReply] = useState(defaults?.autoReplyEnabled ?? false);

  const hasToken = defaults?.hasToken ?? false;
  const hasSecret = defaults?.hasAppSecret ?? false;

  return (
    <form action={formAction} className="space-y-4 p-5 sm:p-6">
      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Название"
          name="label"
          defaultValue={defaults?.label ?? 'Основной'}
          required
          hint="Как номер называется у вас: «Основной», «Отдел Куралай»"
        />
        <Field
          label="Номер телефона"
          name="displayPhone"
          defaultValue={defaults?.displayPhone ?? ''}
          placeholder="+7 700 000 00 00"
          hint="Только для показа в списке — на приём не влияет"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Идентификатор номера"
          name="phoneNumberId"
          defaultValue={defaults?.phoneNumberId ?? ''}
          required
          placeholder="109876543210987"
          hint="Meta for Developers → WhatsApp → «Phone number ID»"
        />
        <Field
          label="Идентификатор WABA"
          name="wabaId"
          defaultValue={defaults?.wabaId ?? ''}
          placeholder="209876543210987"
          hint="Нужен для отправки покупок в Meta"
        />
      </div>

      {departments.length > 0 ? (
        <div>
          <label htmlFor="departmentId" className="block text-[13px] font-medium text-ink-soft">
            Отдел продаж
          </label>
          <select
            id="departmentId"
            name="departmentId"
            defaultValue={defaults?.departmentId ?? ''}
            className="mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink focus:border-lime/50 focus:outline-none"
          >
            <option value="">Весь проект</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12px] text-faint">
            Написали на этот номер — заявка попадёт сразу в выбранный отдел.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={hasToken ? 'Новый токен доступа' : 'Токен доступа'}
          name="token"
          type="password"
          autoComplete="off"
          placeholder={hasToken ? 'Оставьте пустым, чтобы не менять' : 'EAA…'}
          hint={
            hasToken
              ? 'Токен сохранён и зашифрован'
              : 'Постоянный токен системного пользователя'
          }
        />
        <Field
          label={hasSecret ? 'Новый секрет приложения' : 'Секрет приложения'}
          name="appSecret"
          type="password"
          autoComplete="off"
          placeholder={hasSecret ? 'Оставьте пустым, чтобы не менять' : 'App Secret'}
          hint={
            hasSecret
              ? 'Секрет сохранён и зашифрован'
              : 'Без него подпись не проверить, и приём работать не будет'
          }
        />
      </div>

      <div className="rounded-panel border border-line bg-surface-2 p-4">
        <label className="flex items-center gap-2.5 text-[13px] text-ink">
          <input
            type="checkbox"
            name="autoReplyEnabled"
            checked={autoReply}
            onChange={(event) => setAutoReply(event.target.checked)}
            className="size-4 rounded border-line accent-lime"
          />
          Отвечать автоматически на первое сообщение
        </label>

        {autoReply ? (
          <div className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="autoReplyDay"
                className="block text-[13px] font-medium text-ink-soft"
              >
                Ответ в рабочие часы
              </label>
              <textarea
                id="autoReplyDay"
                name="autoReplyDay"
                rows={2}
                defaultValue={defaults?.autoReplyDay ?? ''}
                placeholder="Здравствуйте! Менеджер ответит в течение нескольких минут."
                className="mt-2 w-full rounded-control border border-line bg-surface px-3.5 py-2.5 text-[14px] text-ink placeholder:text-faint focus:border-lime/50 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="autoReplyNight"
                className="block text-[13px] font-medium text-ink-soft"
              >
                Ответ в нерабочее время
              </label>
              <textarea
                id="autoReplyNight"
                name="autoReplyNight"
                rows={2}
                defaultValue={defaults?.autoReplyNight ?? ''}
                placeholder="Здравствуйте! Мы уже не работаем — ответим утром."
                className="mt-2 w-full rounded-control border border-line bg-surface px-3.5 py-2.5 text-[14px] text-ink placeholder:text-faint focus:border-lime/50 focus:outline-none"
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                Обещание «ответим через минуту» в три часа ночи расстраивает
                клиента дважды. Оставите пустым — ночью уйдёт дневной текст.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Начало рабочего дня"
                name="workStartTime"
                type="time"
                defaultValue={defaults?.workStartTime?.slice(0, 5) ?? ''}
                hint="Пусто — берём часы компании"
              />
              <Field
                label="Конец рабочего дня"
                name="workEndTime"
                type="time"
                defaultValue={defaults?.workEndTime?.slice(0, 5) ?? ''}
                hint="Пусто — берём часы компании"
              />
            </div>
          </div>
        ) : null}
      </div>

      <FormMessage error={state.error} success={state.success} />
      <SubmitButton isNew={!defaults} />
    </form>
  );
}

function SubmitButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Сохраняем…' : isNew ? 'Подключить номер' : 'Сохранить'}
    </Button>
  );
}
