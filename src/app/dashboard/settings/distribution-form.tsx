'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { updateDistribution, type SettingsState } from './actions';

/**
 * Правила авто-раздачи. Формулировки намеренно бытовые: директор настраивает
 * работу отдела, а не «параметры алгоритма».
 */
export function DistributionForm({
  defaults,
  disabled,
}: {
  defaults: { auto_assign: boolean; sla_minutes: number };
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(updateDistribution, {} as SettingsState);

  return (
    <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
      <fieldset disabled={disabled} className="space-y-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="auto_assign"
            defaultChecked={defaults.auto_assign}
            className="mt-0.5 size-4 rounded border-line-strong bg-surface-2 accent-lime"
          />
          <span>
            <span className="block text-[14px] font-medium text-ink">
              Раздавать лиды автоматически
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-faint">
              Лид уходит тому, кто получил меньше всех за смену, и так до её конца —
              потолка нет. Если на смене никого нет, лид ждёт в очереди.
            </span>
          </span>
        </label>

        <Field
          label="Время на первое касание, минут"
          name="sla_minutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={String(defaults.sla_minutes)}
          hint="Если за это время менеджер не сдвинул лид со статуса «Новый», лид вернётся в очередь и уйдёт другому"
        />
      </fieldset>

      <FormMessage error={state.error} success={state.success} />

      {disabled ? (
        <p className="text-[12.5px] text-faint">
          Настройки меняет только директор компании.
        </p>
      ) : (
        <SubmitButton />
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Сохраняем…' : 'Сохранить'}
    </Button>
  );
}
