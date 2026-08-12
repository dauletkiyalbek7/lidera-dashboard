'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createDirector,
  setCompanyStatus,
  updateCompany,
  type AdminState,
} from '@/app/admin/actions';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';

const selectClass =
  'mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink focus:border-lime/50 focus:outline-none';

export function CompanyEditForm({
  companyId,
  defaults,
}: {
  companyId: string;
  defaults: {
    name: string;
    directorName: string;
    phone: string;
    status: string;
    funnelType: string;
  };
}) {
  const [state, formAction] = useActionState(updateCompany, {} as AdminState);

  return (
    <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
      <input type="hidden" name="companyId" value={companyId} />

      <Field label="Название компании" name="name" defaultValue={defaults.name} required />
      <Field label="Имя директора" name="directorName" defaultValue={defaults.directorName} />
      <Field label="Телефон" name="phone" type="tel" defaultValue={defaults.phone} />

      <div>
        <label htmlFor="status" className="block text-[13px] font-medium text-ink-soft">
          Статус
        </label>
        <select
          id="status"
          name="status"
          defaultValue={defaults.status}
          className={selectClass}
        >
          <option value="active">Активна</option>
          <option value="trial">Пробный период</option>
          <option value="inactive">Деактивирована</option>
        </select>
      </div>

      <div>
        <label htmlFor="funnelType" className="block text-[13px] font-medium text-ink-soft">
          Тип воронки
        </label>
        <select
          id="funnelType"
          name="funnelType"
          defaultValue={defaults.funnelType}
          className={selectClass}
        >
          <option value="trial">Лид → Пробный → Продажа</option>
          <option value="direct">Лид → Обработан → Продажа</option>
        </select>
      </div>

      <FormMessage error={state.error} success={state.success} />
      <SubmitButton label="Сохранить" pendingLabel="Сохраняем…" />
    </form>
  );
}

export function CompanyStatusToggle({
  companyId,
  isActive,
}: {
  companyId: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState(setCompanyStatus, {} as AdminState);

  return (
    <form action={formAction} className="space-y-3 px-5 py-5 sm:px-6">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="status" value={isActive ? 'inactive' : 'active'} />

      <p className="text-[13.5px] leading-relaxed text-muted">
        {isActive
          ? 'Деактивация закрывает вход в кабинет всем пользователям компании. Данные при этом сохраняются.'
          : 'Компания деактивирована — сотрудники не могут войти в кабинет.'}
      </p>

      <FormMessage error={state.error} success={state.success} />

      <StatusButton isActive={isActive} />
    </form>
  );
}

export function DirectorCreateForm({ companyId }: { companyId: string }) {
  const [state, formAction] = useActionState(createDirector, {} as AdminState);

  return (
    <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
      <input type="hidden" name="companyId" value={companyId} />
      <Field label="Имя" name="name" required placeholder="Имя и фамилия" />
      <Field label="Email (логин)" name="email" type="email" required />
      <Field
        label="Временный пароль"
        name="password"
        type="text"
        required
        minLength={8}
        hint="Минимум 8 символов"
      />
      <FormMessage error={state.error} success={state.success} />
      <SubmitButton label="Создать директора" pendingLabel="Создаём…" />
    </form>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function StatusButton({ isActive }: { isActive: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={isActive ? 'danger' : 'primary'} disabled={pending}>
      {pending ? 'Применяем…' : isActive ? 'Деактивировать компанию' : 'Активировать компанию'}
    </Button>
  );
}
