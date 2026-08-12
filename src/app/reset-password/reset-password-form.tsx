'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { updatePassword, type AuthFormState } from '@/app/login/actions';

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePassword, {} as AuthFormState);

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="Новый пароль"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        autoFocus
        hint="Минимум 8 символов"
      />
      <Field
        label="Повторите пароль"
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <FormMessage error={state.error} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Сохраняем…' : 'Сохранить пароль'}
    </Button>
  );
}
