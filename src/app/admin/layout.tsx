import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app/app-shell';
import { requireSuperAdmin } from '@/lib/auth';

export const metadata: Metadata = {
  title: { default: 'Админ-панель', template: '%s — Lidera' },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { profile, email } = await requireSuperAdmin();

  return (
    <AppShell
      nav="admin"
      workspace="Платформа Lidera"
      workspaceHint="Администрирование"
      userName={profile.name || 'Администратор'}
      userEmail={email ?? profile.email ?? ''}
    >
      {children}
    </AppShell>
  );
}
