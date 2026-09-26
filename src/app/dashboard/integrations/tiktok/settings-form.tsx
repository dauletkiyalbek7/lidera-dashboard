'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import { saveTikTokSettings, syncTikTokNow, type TikTokState } from './actions';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';

const CURRENCIES = ['KZT', 'USD', 'EUR', 'RUB'] as const;

/**
 * Подключение кабинета TikTok.
 *
 * Токен вводится здесь и больше никогда не показывается: при следующей правке
 * поле пустое, а прежний токен остаётся. Подсмотреть его через экран или
 * выгрузить из страницы нельзя.
 */
export function TikTokSettingsForm({
  advertiserId,
  accountName,
  currency,
  hasToken,
}: {
  advertiserId: string;
  accountName: string;
  currency: string;
  hasToken: boolean;
}) {
  const [state, formAction] = useActionState(saveTikTokSettings, {} as TikTokState);
  const [syncState, setSyncState] = useState<TikTokState>({});
  const [syncing, startSync] = useTransition();

  return (
    <div className="space-y-4 p-5 sm:p-6">
      <form action={formAction} className="space-y-4">
        <Field
          label="Номер рекламного кабинета"
          name="advertiserId"
          defaultValue={advertiserId}
          required
          placeholder="7688729038727823412"
          hint="TikTok Ads Manager → «Настройки аккаунта», длинное число без дефисов"
        />

        <Field
          label="Название кабинета"
          name="accountName"
          defaultValue={accountName}
          required
          placeholder="Bilim0923"
          hint="Как он называется у вас — это имя будет видно в отчётах"
        />

        <label className="block space-y-1.5">
          <span className="text-[13px] font-medium text-ink">Валюта кабинета</span>
          <select
            name="currency"
            defaultValue={currency || 'KZT'}
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-lime"
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <span className="block text-[12px] text-ink-soft">
            В ней кабинет считает расход. Пересчёт в валюту проекта платформа делает сама,
            по курсу того дня, когда деньги были потрачены.
          </span>
        </label>

        <Field
          label={hasToken ? 'Новый токен доступа' : 'Токен доступа'}
          name="token"
          type="password"
          autoComplete="off"
          placeholder={hasToken ? 'Оставьте пустым, чтобы не менять' : 'Access Token'}
          hint={
            hasToken
              ? 'Токен сохранён и зашифрован. Заполняйте, только если меняете его.'
              : 'Выдаётся приложению в TikTok for Business после авторизации кабинета'
          }
        />

        <FormMessage error={state.error} success={state.success} />
        <SubmitButton />
      </form>

      {hasToken ? (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-[13px] text-ink-soft">
            Синхронизация идёт сама каждые два часа. Кнопка нужна в момент подключения —
            проверить, что ключи рабочие, не дожидаясь цикла.
          </p>

          <FormMessage error={syncState.error} success={syncState.success} />

          <Button
            type="button"
            variant="secondary"
            disabled={syncing}
            onClick={() =>
              startSync(async () => {
                setSyncState({});
                setSyncState(await syncTikTokNow());
              })
            }
          >
            {syncing ? 'Загружаем…' : 'Загрузить сейчас'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Сохраняем…' : 'Сохранить подключение'}
    </Button>
  );
}
