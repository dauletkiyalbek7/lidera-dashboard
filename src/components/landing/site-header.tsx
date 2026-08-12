'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { IconClose, IconMenu } from '@/components/ui/icons';
import { Logo } from '@/components/ui/logo';

const NAV = [
  { href: '/#features', label: 'Возможности' },
  { href: '/#example', label: 'Пример аналитики' },
  { href: '/#how', label: 'Как работает' },
  { href: '/#audience', label: 'Для кого' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line/80 bg-base/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-shell items-center justify-between gap-6 px-5 sm:px-8">
        <Logo />

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Основная навигация">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[13.5px] text-ink-soft transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <ButtonLink href="/login" variant="ghost" size="sm">
            Войти
          </ButtonLink>
          <ButtonLink href="/login" size="sm">
            Получить доступ
          </ButtonLink>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex size-10 items-center justify-center rounded-control border border-line text-ink-soft lg:hidden"
          aria-expanded={open}
          aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
        >
          {open ? <IconClose className="size-5" /> : <IconMenu className="size-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-line bg-base lg:hidden">
          <nav className="mx-auto flex max-w-shell flex-col gap-1 px-5 py-4" aria-label="Мобильная навигация">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-control px-3 py-2.5 text-[15px] text-ink-soft hover:bg-surface-2 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 grid gap-2">
              <ButtonLink href="/login" variant="secondary" onClick={() => setOpen(false)}>
                Войти
              </ButtonLink>
              <ButtonLink href="/login" onClick={() => setOpen(false)}>
                Получить доступ
              </ButtonLink>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
