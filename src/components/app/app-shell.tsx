'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { IconClose, IconLogout, IconMenu } from '@/components/ui/icons';
import { Logo } from '@/components/ui/logo';
import type { FunnelType } from '@/lib/metrics';
import { navFor, type NavKey } from './nav-config';

type AppShellProps = {
  nav: NavKey;
  /** Тип воронки компании: от него зависит состав разделов. */
  funnelType: FunnelType;
  children: ReactNode;
  /** Название компании или «Платформа Lidera» для админа. */
  workspace: string;
  workspaceHint: string;
  userName: string;
  userEmail: string;
};

export function AppShell({
  nav,
  funnelType,
  children,
  workspace,
  workspaceHint,
  userName,
  userEmail,
}: AppShellProps) {
  const groups = navFor(nav, funnelType);
  // Внутри кабинета логотип ведёт на главную кабинета: попадать с рабочего
  // экрана на витрину продукта — неожиданно и раздражает.
  const home = nav === 'admin' ? '/admin' : '/dashboard';
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
        <Logo href={home} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex size-9 items-center justify-center rounded-control text-muted lg:hidden"
          aria-label="Закрыть меню"
        >
          <IconClose className="size-5" />
        </button>
      </div>

      <div className="border-b border-line px-5 py-4">
        <p className="truncate text-[14px] font-medium text-ink">{workspace}</p>
        <p className="mt-0.5 truncate text-[12px] text-faint">{workspaceHint}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Разделы кабинета">
        {groups.map((group) => (
          <div key={group.title} className="mb-5">
            <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-faint">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/dashboard' &&
                    item.href !== '/admin' &&
                    pathname.startsWith(`${item.href}/`));

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      // Переход по ссылке закрывает мобильное меню.
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-control px-3 py-2.5 text-[14px] transition-colors ${
                        active
                          ? 'bg-lime/10 text-lime'
                          : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
                      }`}
                    >
                      <item.icon className="size-[18px] shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-control px-2 py-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[13px] font-semibold text-lime">
            {initials(userName || userEmail)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{userName}</p>
            <p className="truncate text-[11.5px] text-faint">{userEmail}</p>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-negative"
              aria-label="Выйти"
              title="Выйти"
            >
              <IconLogout className="size-[18px]" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      {/* Мобильная шапка */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-base/90 px-4 backdrop-blur lg:hidden">
        <Logo href={home} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex size-10 items-center justify-center rounded-control border border-line text-ink-soft"
          aria-label="Открыть меню"
          aria-expanded={open}
        >
          <IconMenu className="size-5" />
        </button>
      </div>

      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface/40 lg:block">
        {sidebar}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-label="Закрыть меню"
            tabIndex={-1}
          />
          <div className="absolute inset-y-0 left-0 w-[280px] border-r border-line bg-base">
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="min-w-0">{children}</div>
    </div>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return '·';
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}
