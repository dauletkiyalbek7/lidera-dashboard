import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/auth/auth-shell';
import { createServerSupabase } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: 'Новый пароль',
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage() {
  // Ссылка из письма уже обменяна на сессию в /auth/confirm.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/forgot-password?expired=1');

  return (
    <AuthShell
      title="Новый пароль"
      subtitle="Придумайте пароль для входа в кабинет Lidera"
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
