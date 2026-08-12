'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { requestPasswordReset, type AuthFormState } from '@/app/login/actions';

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, {} as AuthFormState);

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="director@company.kz"
        required
        autoFocus
      />
      <FormMessage error={state.error} success={state.success} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Отправляем…' : 'Отправить ссылку'}
    </Button>
  );
}
