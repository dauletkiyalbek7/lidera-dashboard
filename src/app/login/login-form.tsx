'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { signIn, type AuthFormState } from './actions';

const initialState: AuthFormState = {};

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, formAction] = useActionState(signIn, initialState);
  const error = state.error ?? initialError;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="director@company.kz"
        required
        autoFocus
      />

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="block text-[13px] font-medium text-ink-soft">
            Пароль
          </label>
          <Link
            href="/forgot-password"
            className="text-[12.5px] text-muted transition-colors hover:text-lime"
          >
            Забыли пароль?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          className="mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3.5 text-[14.5px] text-ink placeholder:text-faint transition-colors focus:border-lime/50 focus:outline-none"
        />
      </div>

      <FormMessage error={error} />

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Входим…' : 'Войти'}
    </Button>
  );
}
