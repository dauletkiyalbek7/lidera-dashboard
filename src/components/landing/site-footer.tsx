import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';

const LINKS = [
  { href: '/#features', label: 'Возможности' },
  { href: '/#how', label: 'Как работает' },
  { href: '/contacts', label: 'Контакты' },
  { href: '/privacy', label: 'Политика конфиденциальности' },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface/50">
      <div className="mx-auto max-w-shell px-5 py-14 sm:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              Сквозная аналитика рекламы до реальной продажи. Meta Ads и TikTok Ads,
              лиды, продажи и выручка — в одной платформе.
            </p>
          </div>

          <div className="flex flex-col gap-8 sm:flex-row sm:gap-16">
            <nav aria-label="Навигация в подвале">
              <h2 className="text-[12px] font-medium uppercase tracking-[0.18em] text-faint">
                Разделы
              </h2>
              <ul className="mt-4 space-y-3">
                {LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[14px] text-ink-soft transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div>
              <h2 className="text-[12px] font-medium uppercase tracking-[0.18em] text-faint">
                Клиентам Lidera
              </h2>
              <p className="mt-4 max-w-[220px] text-[14px] leading-relaxed text-muted">
                Уже работаете с нами? Заходите в свой рабочий кабинет.
              </p>
              <ButtonLink href="/login" className="mt-4" size="sm">
                Войти
              </ButtonLink>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-[13px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Lidera. Все права защищены.</p>
          <p>lidera.kz</p>
        </div>
      </div>
    </footer>
  );
}
