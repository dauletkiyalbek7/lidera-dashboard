'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { updateCompany, type SettingsState } from './actions';

export function CompanyForm({
  defaults,
  disabled,
}: {
  defaults: { name: string; director_name: string; phone: string };
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(updateCompany, {} as SettingsState);

  return (
    <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
      <fieldset disabled={disabled} className="space-y-4">
        <Field label="Название компании" name="name" defaultValue={defaults.name} required />
        <Field
          label="Имя директора"
          name="director_name"
          defaultValue={defaults.director_name}
        />
        <Field label="Телефон" name="phone" type="tel" defaultValue={defaults.phone} />
      </fieldset>

      <FormMessage error={state.error} success={state.success} />

      {disabled ? (
        <p className="text-[12.5px] text-faint">
          Редактирование доступно только директору компании.
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
