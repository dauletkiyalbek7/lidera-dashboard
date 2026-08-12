import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Вход',
  description: 'Войдите в рабочий кабинет Lidera.',
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  no_company: 'К вашей учётной записи не привязана компания. Обратитесь в поддержку Lidera.',
  company_inactive: 'Доступ компании приостановлен. Свяжитесь с администратором Lidera.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '';
  const initialError = params.error ? ERRORS[params.error] : undefined;

  return (
    <AuthShell
      title="Вход в Lidera"
      subtitle="Войдите в свой рабочий кабинет"
      footer={
        <p className="text-[13px] leading-relaxed text-muted">
          Ещё не подключены к платформе?{' '}
          <Link href="/contacts" className="text-lime transition-colors hover:underline">
            Свяжитесь с нами
          </Link>{' '}
          — доступ выдаёт администратор Lidera.
        </p>
      }
    >
      <LoginForm next={next} initialError={initialError} />
    </AuthShell>
  );
}
