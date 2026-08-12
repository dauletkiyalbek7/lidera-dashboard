import type { Metadata } from 'next';

import { SiteFooter } from '@/components/landing/site-footer';
import { SiteHeader } from '@/components/landing/site-header';
import { ButtonLink } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Контакты',
  description: 'Свяжитесь с командой Lidera — подключение, доступы и поддержка.',
  alternates: { canonical: '/contacts' },
};

const CONTACTS = [
  { label: 'Почта', value: 'hello@lidera.kz', href: 'mailto:hello@lidera.kz' },
  { label: 'Поддержка клиентов', value: 'support@lidera.kz', href: 'mailto:support@lidera.kz' },
  { label: 'Сайт', value: 'lidera.kz', href: 'https://lidera.kz' },
];

export default function ContactsPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
          <SectionTitle
            eyebrow="Контакты"
            title="Поговорим о вашей рекламе"
            description="Подключение кабинетов, доступы для команды и вопросы по платформе — пишите, отвечаем в рабочие часы."
          />

          <dl className="mt-12 grid gap-4 sm:grid-cols-3">
            {CONTACTS.map((contact) => (
              <div
                key={contact.label}
                className="rounded-card border border-line bg-surface p-6"
              >
                <dt className="text-[12px] font-medium uppercase tracking-[0.18em] text-faint">
                  {contact.label}
                </dt>
                <dd className="mt-3">
                  <a
                    href={contact.href}
                    className="text-[15px] text-ink transition-colors hover:text-lime"
                  >
                    {contact.value}
                  </a>
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-10">
            <ButtonLink href="/login">Войти в кабинет</ButtonLink>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
