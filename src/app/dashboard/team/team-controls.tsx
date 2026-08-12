'use client';

import { useActionState, useState, useTransition } from 'react';

import {
  createEmployee,
  fireEmployee,
  rehireEmployee,
  type TeamState,
} from '@/app/dashboard/team/actions';
import { Done, SubmitButton } from '@/app/dashboard/leads/lead-controls';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { IconPlus } from '@/components/ui/icons';
import { Modal, Select } from '@/components/ui/modal';
import { EMPLOYEE_ROLE, employeeRolesFor } from '@/lib/employee-role';
import type { FunnelType } from '@/lib/metrics';

/** Кнопка «Добавить сотрудника». Роли зависят от воронки компании. */
export function AddEmployeeButton({ funnelType }: { funnelType: FunnelType }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createEmployee, {} as TeamState);

  const roles = employeeRolesFor(funnelType).map((role) => ({
    value: role,
    label: EMPLOYEE_ROLE[role].label,
  }));

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <IconPlus className="size-4" />
        Добавить сотрудника
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Новый сотрудник"
        description="Входа в кабинет у сотрудника нет — работать он будет через Telegram-бот."
      >
        {state.success ? (
          <Done message={state.success} onClose={() => setOpen(false)} />
        ) : (
          <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
            <Field label="Имя и фамилия" name="fullName" required placeholder="Айгерим Сериковна" />
            <Select
              label="Роль"
              name="role"
              defaultValue="manager"
              options={roles}
              hint={
                funnelType === 'trial'
                  ? 'Менеджер записывает на пробное, продажник проводит его и закрывает продажу'
                  : 'Менеджер ведёт лид от заявки до оплаты'
              }
            />
            <Field label="Телефон" name="phone" type="tel" placeholder="+7 700 000 00 00" />
            <FormMessage error={state.error} />
            <SubmitButton label="Добавить" pendingLabel="Сохраняем…" />
          </form>
        )}
      </Modal>
    </>
  );
}

/**
 * Увольнение и возврат. Подтверждение обязательно: увольнение освобождает
 * активные лиды сотрудника, и это видно всей команде.
 */
export function EmployeeRowActions({
  employeeId,
  fullName,
  status,
}: {
  employeeId: string;
  fullName: string;
  status: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<TeamState>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else setConfirming(false);
    });
  };

  if (status === 'fired') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => rehireEmployee(employeeId))}
        >
          Вернуть
        </Button>
        {error ? <p className="text-[11px] text-negative">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Уволить
      </Button>
      {error ? <p className="text-[11px] text-negative">{error}</p> : null}

      {confirming ? (
        <Modal
          open
          onClose={() => setConfirming(false)}
          title="Уволить сотрудника"
          description={fullName}
        >
          <div className="space-y-4 px-5 py-5 sm:px-6">
            <p className="text-[13.5px] leading-relaxed text-ink-soft">
              Карточка и вся история останутся — отчёты за прошлые периоды не изменятся.
              Активные лиды освободятся, и их можно будет назначить другому.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setConfirming(false)}
              >
                Отмена
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={pending}
                onClick={() => run(() => fireEmployee(employeeId))}
              >
                {pending ? 'Увольняем…' : 'Уволить'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
