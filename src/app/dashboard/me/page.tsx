import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { requireCompanySession } from '@/lib/auth';
import { employeeRoleLabel } from '@/lib/employee-role';
import { PasswordForm, TelegramLink } from './profile-controls';

/**
 * Личная страница сотрудника: подключение к боту и смена пароля.
 *
 * Руководителю она не нужна — у него нет карточки сотрудника, и заявки ему в
 * бот не приходят.
 */

export const metadata: Metadata = { title: 'Мой профиль' };

export default async function ProfilePage() {
  const { employee, profile, email } = await requireCompanySession();

  if (!employee) redirect('/dashboard');

  return (
    <>
      <PageHeader
        title={employee.fullName || profile.name}
        description={`${employeeRoleLabel(employee.role)} · ${email ?? profile.email ?? ''}`}
      />

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Telegram"
              subtitle="Заявки приходят в бот: имя, номер и кнопки статусов"
              action={
                employee.telegramLinked ? (
                  <Badge tone="positive">
                    <StatusDot tone="positive" />
                    Подключён
                  </Badge>
                ) : (
                  <Badge tone="neutral">Не подключён</Badge>
                )
              }
            />
            <TelegramLink linked={employee.telegramLinked} />
          </Card>

          <Card>
            <CardHeader title="Пароль" subtitle="Вход в кабинет по вашей почте" />
            <PasswordForm />
          </Card>
        </div>
      </PageBody>
    </>
  );
}
