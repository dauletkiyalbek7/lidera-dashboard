import Link from 'next/link';
import type { ReactNode } from 'react';

import { IconArrowRight, IconChain, IconLock, IconSpark } from '@/components/ui/icons';
import { Logo } from '@/components/ui/logo';

const HIGHLIGHTS = [
  { icon: IconChain, text: 'Реклама → Лид → Пробный → Продажа → Выручка' },
  { icon: IconSpark, text: 'ROAS и ROI по каждому креативу' },
  { icon: IconLock, text: 'Данные компании изолированы на уровне базы' },
];

/** Общий каркас экранов входа и восстановления пароля. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,520px)]">
      {/* Брендовая половина — скрыта на мобильном, чтобы форма была первой */}
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface/40 lg:block">
        <div className="glow-lime pointer-events-none absolute inset-x-0 top-0 h-[520px]" />
        <div className="grid-bg pointer-events-none absolute inset-0" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo />
          <div className="max-w-md">
            <p className="text-[12px] font-medium uppercase tracking-[0.22em] text-lime">
              Рабочий кабинет
            </p>
            <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.12] tracking-[-0.025em] text-ink">
              Сквозная аналитика рекламы до реальной продажи
            </h2>
            <ul className="mt-9 space-y-4">
              {HIGHLIGHTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-[14.5px] text-ink-soft">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-panel border border-line bg-surface text-lime">
                    <Icon className="size-4" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[13.5px] text-muted transition-colors hover:text-ink"
          >
            Вернуться на сайт Lidera
            <IconArrowRight className="size-3.5" />
          </Link>
        </div>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <Logo />
          </div>

          <h1 className="mt-10 text-[28px] font-semibold tracking-[-0.025em] text-ink lg:mt-0 sm:text-[32px]">
            {title}
          </h1>
          <p className="mt-2.5 text-[14.5px] text-muted">{subtitle}</p>

          <div className="mt-8">{children}</div>

          {footer ? <div className="mt-8">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
