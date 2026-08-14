'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { saveCapiSettings, sendTestPurchase, type AdminState } from '@/app/admin/actions';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';

/**
 * Настройка отправки покупок в Meta.
 *
 * Токен вводится один раз и обратно не показывается: в базе он зашифрован, а
 * на экране от него остаётся только хвост — чтобы было видно, что он есть.
 */
export function CapiForm({
  companyId,
  current,
}: {
  companyId: string;
  current: {
    datasetId: string;
    testEventCode: string | null;
    lastEventAt: string | null;
    lastError: string | null;
  } | null;
}) {
  const [state, formAction] = useActionState(saveCapiSettings, {} as AdminState);
  const [testState, testAction] = useActionState(sendTestPurchase, {} as AdminState);

  return (
    <div>
      {current ? (
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <p className="text-[13.5px] text-ink">
            Набор данных <span className="tabular">{current.datasetId}</span> · токен
            сохранён
          </p>
          {current.lastError ? (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-negative">
              Последняя отправка не удалась: {current.lastError}
            </p>
          ) : (
            <p className="mt-1 text-[12px] text-faint">
              {current.lastEventAt
                ? `Последнее событие: ${new Date(current.lastEventAt).toLocaleString('ru-RU')}`
                : 'Событий ещё не отправляли'}
            </p>
          )}

          <form action={testAction} className="mt-3">
            <input type="hidden" name="companyId" value={companyId} />
            <TestButton />
          </form>

          <div className="mt-3">
            <FormMessage error={testState.error} success={testState.success} />
          </div>
        </div>
      ) : null}

      <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
        <input type="hidden" name="companyId" value={companyId} />

        <Field
          label="Номер набора данных"
          name="datasetId"
          defaultValue={current?.datasetId ?? ''}
          placeholder="1234567890123456"
          required
        />
        <Field
          label={current ? 'Новый токен (заменит прежний)' : 'Токен Conversions API'}
          name="token"
          type="password"
          placeholder="EAAG…"
          required
        />
        <Field
          label="Код тестовых событий (необязательно)"
          name="testEventCode"
          defaultValue={current?.testEventCode ?? ''}
          placeholder="TEST12345"
        />

        <p className="text-[12px] leading-relaxed text-faint">
          Оба значения берутся в Events Manager: набор данных → Настройки → Conversions
          API. Пока указан код тестовых событий, покупки видно во вкладке «Тестирование
          событий», но в обучение рекламы они не идут — уберите его, когда проверите.
        </p>

        <FormMessage error={state.error} success={state.success} />

        <Save />
      </form>
    </div>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Сохраняем…' : 'Сохранить'}
    </Button>
  );
}

function TestButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? 'Отправляем…' : 'Отправить тестовое событие'}
    </Button>
  );
}
