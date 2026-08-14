'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { saveCapiSettings, type CapiState } from './actions';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';

/**
 * Настройки отправки покупок в Meta.
 *
 * Токен вводится здесь и больше никогда не показывается: при следующей правке
 * поле пустое, а прежний токен остаётся. Так его нельзя ни подсмотреть через
 * экран, ни выгрузить из страницы.
 */
export function CapiSettingsForm({
  datasetId,
  testEventCode,
  enabled,
  hasToken,
}: {
  datasetId: string;
  testEventCode: string | null;
  enabled: boolean;
  hasToken: boolean;
}) {
  const [state, formAction] = useActionState(saveCapiSettings, {} as CapiState);

  return (
    <form action={formAction} className="space-y-4 p-5 sm:p-6">
      <Field
        label="Идентификатор набора данных"
        name="datasetId"
        defaultValue={datasetId}
        required
        placeholder="962785768710642"
        hint="Events Manager → ваш набор данных → «Настройки»"
      />

      <Field
        label={hasToken ? 'Новый токен доступа' : 'Токен доступа'}
        name="token"
        type="password"
        autoComplete="off"
        placeholder={hasToken ? 'Оставьте пустым, чтобы не менять' : 'EAA…'}
        hint={
          hasToken
            ? 'Токен сохранён и зашифрован. Заполняйте, только если меняете его.'
            : 'Создаётся в Events Manager, в разделе Conversions API'
        }
      />

      <Field
        label="Код проверочных событий"
        name="testEventCode"
        defaultValue={testEventCode ?? ''}
        placeholder="TEST12345"
        hint="Пока указан, события видны во вкладке «Тестирование» и не идут в обучение рекламы"
      />

      <label className="flex items-center gap-2.5 text-[13px] text-ink">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          className="size-4 rounded border-line accent-lime"
        />
        Отправлять покупки в Meta
      </label>

      <FormMessage error={state.error} success={state.success} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Сохраняем…' : 'Сохранить настройки'}
    </Button>
  );
}
