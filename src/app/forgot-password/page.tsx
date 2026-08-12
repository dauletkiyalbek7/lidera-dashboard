import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Восстановление пароля',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Забыли пароль?"
      subtitle="Укажите email — пришлём ссылку для входа и смены пароля"
      footer={
        <p className="text-[13px] text-muted">
          Вспомнили пароль?{' '}
          <Link href="/login" className="text-lime transition-colors hover:underline">
            Вернуться ко входу
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
