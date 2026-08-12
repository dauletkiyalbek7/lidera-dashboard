'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { createCompany, type AdminState } from '@/app/admin/actions';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';

const selectClass =
  'mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink focus:border-lime/50 focus:outline-none';

export function CompanyCreateForm() {
  const [state, formAction] = useActionState(createCompany, {} as AdminState);

  return (
    <form action={formAction} className="space-y-5 px-5 py-6 sm:px-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название компании" name="name" required placeholder="Demo Company" />
        <Field label="Имя директора" name="directorName" required placeholder="Айгерим Смагулова" />
        <Field
          label="Email директора"
          name="email"
          type="email"
          required
          placeholder="director@company.kz"
          hint="Он же логин для входа в кабинет"
        />
        <Field label="Телефон" name="phone" type="tel" placeholder="+7 700 000 00 00" />
        <Field
          label="Временный пароль"
          name="password"
          type="text"
          required
          minLength={8}
          placeholder="Минимум 8 символов"
          hint="Передайте директору — он сможет сменить его в разделе «Забыли пароль»"
        />

        <div>
          <label htmlFor="status" className="block text-[13px] font-medium text-ink-soft">
            Статус компании
          </label>
          <select id="status" name="status" defaultValue="active" className={selectClass}>
            <option value="active">Активна</option>
            <option value="trial">Пробный период</option>
            <option value="inactive">Деактивирована</option>
          </select>
        </div>

        <div>
          <label htmlFor="plan" className="block text-[13px] font-medium text-ink-soft">
            Тариф
          </label>
          <select id="plan" name="plan" defaultValue="trial" className={selectClass}>
            <option value="trial">Пробный</option>
            <option value="start">Start</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </div>

      <FormMessage error={state.error} success={state.success} />

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Создаём…' : 'Создать компанию и директора'}
    </Button>
  );
}
