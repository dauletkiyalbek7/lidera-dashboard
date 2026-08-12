import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app/app-shell';
import { requireCompanySession } from '@/lib/auth';

export const metadata: Metadata = {
  title: { default: 'Кабинет', template: '%s — Lidera' },
  robots: { index: false, follow: false },
};

const PLAN_HINT: Record<string, string> = {
  active: 'Компания активна',
  trial: 'Пробный период',
  inactive: 'Доступ приостановлен',
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Единственный источник правды по доступу: сессия + роль + статус компании.
  const { profile, company, email } = await requireCompanySession();

  return (
    <AppShell
      nav="company"
      funnelType={company.funnel_type}
      workspace={company.name}
      workspaceHint={PLAN_HINT[company.status] ?? 'Компания'}
      userName={profile.name || 'Пользователь'}
      userEmail={email ?? profile.email ?? ''}
    >
      {children}
    </AppShell>
  );
}
