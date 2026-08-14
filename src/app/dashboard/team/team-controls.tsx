'use client';

import { useActionState, useState, useTransition } from 'react';

import {
  createEmployee,
  createEmployeeLogin,
  createInvite,
  fireEmployee,
  rehireEmployee,
  revokeEmployeeLogin,
  updateEmployeeSchedule,
  type InviteState,
  type LoginState,
  type TeamState,
} from '@/app/dashboard/team/actions';
import { Done, SubmitButton } from '@/app/dashboard/leads/lead-controls';
import { Field, FormMessage } from '@/components/auth/field';
import { WorkScheduleEditor } from '@/components/app/work-schedule';
import { Button } from '@/components/ui/button';
import { IconPlus } from '@/components/ui/icons';
import { Modal, Select } from '@/components/ui/modal';
import {
  SHIFT_MODE,
  SHIFT_MODE_ORDER,
  formatDuration,
  formatSchedule,
  shiftDurationMinutes,
  type ShiftMode,
} from '@/lib/attendance';
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
 * Ссылка-приглашение в бот. Показываем её в окне, а не копируем молча:
 * директор должен видеть, что именно он отправляет сотруднику.
 */
export function InviteButton({
  employeeId,
  fullName,
  linked,
}: {
  employeeId: string;
  fullName: string;
  linked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<InviteState>({});
  const [copied, setCopied] = useState(false);

  const request = () => {
    setOpen(true);
    setCopied(false);
    setState({});
    startTransition(async () => setState(await createInvite(employeeId)));
  };

  const copy = async () => {
    if (!state.link) return;
    await navigator.clipboard.writeText(state.link);
    setCopied(true);
  };

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={request}>
        {linked ? 'Новая ссылка' : 'Пригласить'}
      </Button>

      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Ссылка для входа в бот"
          description={fullName}
        >
          <div className="space-y-4 px-5 py-5 sm:px-6">
            {pending ? <p className="text-[13.5px] text-muted">Готовим ссылку…</p> : null}

            {state.error ? (
              <p className="text-[13.5px] text-negative">{state.error}</p>
            ) : null}

            {state.link ? (
              <>
                <p className="text-[13.5px] leading-relaxed text-ink-soft">
                  Отправьте ссылку сотруднику. Она сработает один раз и сгорит через
                  48 часов — прежние ссылки этого человека уже недействительны.
                </p>
                <p className="break-all rounded-control border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink">
                  {state.link}
                </p>
                <Button type="button" className="w-full" onClick={copy}>
                  {copied ? 'Скопировано' : 'Скопировать ссылку'}
                </Button>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Личный режим смены и график сотрудника.
 *
 * Два независимых выбора: как человек отмечается (режим) и когда он работает
 * (график). Каждый можно оставить «как в компании» — тогда в базе NULL, и
 * общее правило продолжает доходить до него само.
 */
export function ScheduleButton({
  employeeId,
  fullName,
  defaults,
  company,
}: {
  employeeId: string;
  fullName: string;
  defaults: {
    shiftMode: string | null;
    workStartTime: string | null;
    workEndTime: string | null;
    workDays: number[] | null;
    lateGraceMinutes: number | null;
  };
  company: {
    mode: ShiftMode;
    workStartTime: string;
    workEndTime: string;
    workDays: number[];
    lateGraceMinutes: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(updateEmployeeSchedule, {} as TeamState);

  const [mode, setMode] = useState(defaults.shiftMode ?? '');
  const [custom, setCustom] = useState(
    defaults.workStartTime !== null ||
      defaults.workEndTime !== null ||
      defaults.workDays !== null ||
      defaults.lateGraceMinutes !== null,
  );

  const companyDay = shiftDurationMinutes(company.workStartTime, company.workEndTime);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        График
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Режим работы и график"
        description={fullName}
      >
        {state.success ? (
          <Done message={state.success} onClose={() => setOpen(false)} />
        ) : (
          <form action={formAction} className="space-y-5 px-5 py-5 sm:px-6">
            <input type="hidden" name="employeeId" value={employeeId} />

            <div className="space-y-2">
              <span className="block text-[13px] font-medium text-ink-soft">
                Как отмечается
              </span>

              {[
                {
                  value: '',
                  label: 'Как в компании',
                  hint: SHIFT_MODE[company.mode].label,
                },
                ...SHIFT_MODE_ORDER.map((key) => ({
                  value: key as string,
                  label: SHIFT_MODE[key].label,
                  hint: SHIFT_MODE[key].hint,
                })),
              ].map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                    mode === option.value
                      ? 'border-lime/40 bg-lime/[0.06]'
                      : 'border-line hover:border-line-strong'
                  }`}
                >
                  <input
                    type="radio"
                    name="shiftMode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    className="mt-0.5 size-4 accent-lime"
                  />
                  <span>
                    <span className="block text-[14px] font-medium text-ink">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-faint">
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-soft">График работы</span>
                <div className="flex rounded-control border border-line bg-surface-2 p-0.5">
                  {[
                    { value: false, label: 'Как в компании' },
                    { value: true, label: 'Свой' },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setCustom(option.value)}
                      className={`h-7 rounded-[10px] px-3 text-[12.5px] font-medium transition-colors ${
                        custom === option.value
                          ? 'bg-surface text-ink shadow-sm'
                          : 'text-muted hover:text-ink'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <input type="hidden" name="scheduleMode" value={custom ? 'custom' : 'inherit'} />

              {custom ? (
                <WorkScheduleEditor
                  names={{
                    days: 'workDays',
                    start: 'workStartTime',
                    end: 'workEndTime',
                    grace: 'lateGraceMinutes',
                  }}
                  defaults={{
                    days: defaults.workDays ?? company.workDays,
                    start: defaults.workStartTime ?? company.workStartTime,
                    end: defaults.workEndTime ?? company.workEndTime,
                    grace: defaults.lateGraceMinutes ?? company.lateGraceMinutes,
                  }}
                />
              ) : (
                <div className="rounded-control border border-line bg-surface-2/40 px-3.5 py-3">
                  <p className="text-[13.5px] text-ink">
                    {formatSchedule({
                      workDays: company.workDays,
                      workStartTime: company.workStartTime,
                      workEndTime: company.workEndTime,
                    })}
                  </p>
                  <p className="tabular mt-0.5 text-[12px] text-faint">
                    {formatDuration(companyDay)} в день · допуск{' '}
                    {company.lateGraceMinutes} мин
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-faint">
                    Меняется в «Настройках» и применяется ко всем, у кого нет своего
                    графика.
                  </p>
                </div>
              )}
            </div>

            <FormMessage error={state.error} />
            <SubmitButton label="Сохранить" pendingLabel="Сохраняем…" />
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

/**
 * Выдача сотруднику входа в кабинет.
 *
 * Пароль директор задаёт сам и передаёт лично: почтового ящика у менеджера
 * может не быть, и письмо-приглашение до него просто не дойдёт. После
 * сохранения пароль на экране больше не показывается — в базе его нет
 * в открытом виде.
 */
export function LoginButton({
  employeeId,
  fullName,
  hasLogin,
  loginEmail,
}: {
  employeeId: string;
  fullName: string;
  hasLogin: boolean;
  loginEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createEmployeeLogin, {} as LoginState);
  const [revoking, startRevoke] = useTransition();
  const [revokeError, setRevokeError] = useState<string | null>(null);

  if (hasLogin) {
    return (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Вход есть
        </Button>

        {open ? (
          <Modal
            open
            onClose={() => setOpen(false)}
            title={`Вход в кабинет — ${fullName}`}
            description={loginEmail ? `Логин: ${loginEmail}` : undefined}
          >
            <div className="space-y-4 px-5 py-5 sm:px-6">
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Пароль хранится только в зашифрованном виде — показать его нельзя.
                Если сотрудник забыл пароль, он восстанавливает его сам по ссылке
                «Забыли пароль» на странице входа.
              </p>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Закрыть вход можно в любой момент: карточка, лиды и вся история
                сотрудника при этом сохраняются.
              </p>
              {revokeError ? (
                <p className="text-[12.5px] text-negative">{revokeError}</p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={revoking}
                onClick={() =>
                  startRevoke(async () => {
                    const result = await revokeEmployeeLogin(employeeId);
                    if (result.error) setRevokeError(result.error);
                    else setOpen(false);
                  })
                }
              >
                {revoking ? 'Закрываем…' : 'Закрыть вход'}
              </Button>
            </div>
          </Modal>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Выдать вход
      </Button>

      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={`Вход в кабинет — ${fullName}`}
          description="Сотрудник войдёт по этой почте и увидит только свои заявки."
        >
          {state.success ? (
            <Done message={state.success} onClose={() => setOpen(false)} />
          ) : (
            <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
              <input type="hidden" name="employeeId" value={employeeId} />
              <Field
                label="Почта — она же логин"
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="arman@company.kz"
              />
              <Field
                label="Пароль"
                name="password"
                type="text"
                required
                minLength={10}
                autoComplete="off"
                placeholder="не короче 10 знаков"
                hint="Передайте его сотруднику лично — на экране он больше не появится"
              />
              <FormMessage error={state.error} />
              <SubmitButton label="Выдать вход" pendingLabel="Создаём…" />
            </form>
          )}
        </Modal>
      ) : null}
    </>
  );
}
