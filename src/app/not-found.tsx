import type { Metadata } from 'next';

import { ButtonLink } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';

export const metadata: Metadata = {
  title: 'Страница не найдена',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 text-center">
      <div className="glow-lime pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <div className="grid-bg pointer-events-none absolute inset-0" />

      <div className="relative">
        <Logo />
        <p className="tabular mt-12 text-[80px] font-semibold leading-none tracking-[-0.04em] text-lime sm:text-[120px]">
          404
        </p>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
          Такой страницы нет
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
          Возможно, ссылка устарела или страница была перенесена. Вернитесь на главную
          или войдите в рабочий кабинет.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/">На главную</ButtonLink>
          <ButtonLink href="/login" variant="secondary">
            Войти в кабинет
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
