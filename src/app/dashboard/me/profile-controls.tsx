'use client';

import { useActionState, useState, useTransition } from 'react';

import { changeMyPassword, linkMyTelegram, type LinkState } from './actions';
import { Done, SubmitButton } from '@/app/dashboard/leads/lead-controls';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';

/**
 * Подключение Telegram к своей карточке.
 *
 * Ссылку сотрудник получает сам и сразу открывает на телефоне — пересылать её
 * через директора не нужно. Действует двое суток и гасится при первом входе.
 */
export function TelegramLink({ linked }: { linked: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<LinkState>({});
  const [copied, setCopied] = useState(false);

  const request = () => {
    setCopied(false);
    setState({});
    startTransition(async () => setState(await linkMyTelegram()));
  };

  const copy = async () => {
    if (!state.link) return;
    await navigator.clipboard.writeText(state.link);
    setCopied(true);
  };

  return (
    <div className="space-y-4 p-5 sm:p-6">
      <p className="text-[13px] leading-relaxed text-ink-soft">
        {linked
          ? 'Telegram подключён — заявки приходят в бот. Если поменяли аккаунт, получите новую ссылку.'
          : 'Пока Telegram не подключён, новые заявки будут видны только здесь, в кабинете. Подключите бот, чтобы получать их сразу на телефон.'}
      </p>

      <Button type="button" variant={linked ? 'secondary' : 'primary'} onClick={request} disabled={pending}>
        {pending ? 'Готовим ссылку…' : linked ? 'Новая ссылка' : 'Подключить Telegram'}
      </Button>

      {state.error ? <p className="text-[12.5px] text-negative">{state.error}</p> : null}

      {state.link ? (
        <div className="space-y-2 rounded-control border border-line bg-surface-2 p-3.5">
          <p className="text-[12.5px] text-muted">
            Откройте ссылку на телефоне — она свяжет ваш Telegram с этой карточкой.
            Действует двое суток и только один раз.
          </p>
          <p className="break-all text-[13px] text-ink">{state.link}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={copy} variant="secondary">
              {copied ? 'Скопировано' : 'Скопировать'}
            </Button>
            <a
              href={state.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-control bg-lime px-3 text-[12.5px] font-medium text-ink-invert transition-colors hover:bg-lime-strong"
            >
              Открыть в Telegram
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Смена собственного пароля. */
export function PasswordForm() {
  const [state, formAction] = useActionState(changeMyPassword, {} as { error?: string; success?: string });

  if (state.success) {
    return (
      <div className="p-5 sm:p-6">
        <Done message={state.success} onClose={() => location.reload()} />
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 p-5 sm:p-6">
      <Field
        label="Новый пароль"
        name="password"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        placeholder="не короче 10 знаков"
        hint="Директор ваш пароль не видит и не может его посмотреть"
      />
      <FormMessage error={state.error} />
      <SubmitButton label="Сменить пароль" pendingLabel="Меняем…" />
    </form>
  );
}
