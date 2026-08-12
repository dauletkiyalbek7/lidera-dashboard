'use client';

import { useEffect } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // В проде сюда подключается внешний сборщик ошибок.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <Logo />
      <h1 className="mt-10 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
        Что-то пошло не так
      </h1>
      <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
        Мы не смогли загрузить страницу. Попробуйте повторить — если ошибка
        повторяется, напишите нам на support@lidera.kz.
      </p>
      {error.digest ? (
        <p className="tabular mt-3 text-[12px] text-faint">Код ошибки: {error.digest}</p>
      ) : null}
      <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
        <Button onClick={reset}>Повторить</Button>
        <ButtonLink href="/" variant="secondary">
          На главную
        </ButtonLink>
      </div>
    </div>
  );
}
