'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { renameCreative, type CreativeState } from '../actions';

/**
 * Своё имя ролика.
 *
 * Пустое поле — платформа подписывает сама: «Видео 3». Так в таблицах видно
 * короткое имя вместо текста объявления на пол-экрана.
 */
export function CreativeRenameForm({
  creativeId,
  label,
  fallback,
  disabled,
}: {
  creativeId: string;
  label: string | null;
  fallback: string;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(renameCreative, {} as CreativeState);

  return (
    <form action={formAction} className="space-y-3 px-5 py-5 sm:px-6">
      <input type="hidden" name="creativeId" value={creativeId} />
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          name="label"
          defaultValue={label ?? ''}
          placeholder={fallback}
          maxLength={40}
          disabled={disabled}
          className="h-11 min-w-0 flex-1 rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink focus:border-lime/50 focus:outline-none disabled:opacity-60"
        />
        <Save disabled={disabled} />
      </div>
      <p className="text-[12px] leading-relaxed text-faint">
        Оставьте пустым — платформа подпишет «{fallback}».
      </p>
      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}

function Save({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="field" disabled={disabled || pending}>
      {pending ? 'Сохраняем…' : 'Сохранить'}
    </Button>
  );
}
