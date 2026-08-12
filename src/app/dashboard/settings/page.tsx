import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { requireCompanySession } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { COMPANY_STATUS, PLAN_LABELS, ROLE_LABELS, statusOf } from '@/lib/labels';
import { getSubscription } from '@/lib/queries';
import { CompanyForm } from './company-form';

export const metadata: Metadata = { title: 'Настройки' };

export default async function SettingsPage() {
  const { company, profile, email } = await requireCompanySession();
  const subscription = await getSubscription(company.id);
  const status = statusOf(COMPANY_STATUS, company.status);

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Данные компании, ваша учётная запись и текущий тариф."
      />

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Компания"
              subtitle="Эти данные видит команда внутри кабинета"
              action={<Badge tone={status.tone}>{status.label}</Badge>}
            />
            <CompanyForm
              defaults={{
                name: company.name,
                director_name: company.director_name ?? '',
                phone: company.phone ?? '',
                funnel_type: company.funnel_type,
              }}
              disabled={profile.role !== 'DIRECTOR'}
            />
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Учётная запись" />
              <dl className="divide-y divide-line">
                <Row label="Имя" value={profile.name || '—'} />
                <Row label="Email" value={email ?? profile.email ?? '—'} />
                <Row label="Роль" value={ROLE_LABELS[profile.role] ?? profile.role} />
                <Row label="В системе с" value={formatDate(profile.created_at)} />
              </dl>
              <div className="border-t border-line px-5 py-4 sm:px-6">
                <form action="/auth/signout" method="post">
                  <Button type="submit" variant="danger" size="sm">
                    Выйти из кабинета
                  </Button>
                </form>
              </div>
            </Card>

            <Card>
              <CardHeader title="Тариф" subtitle="Оплата подключается на следующем этапе" />
              <dl className="divide-y divide-line">
                <Row
                  label="План"
                  value={
                    subscription ? (PLAN_LABELS[subscription.plan] ?? subscription.plan) : '—'
                  }
                />
                <Row
                  label="Действует с"
                  value={subscription ? formatDate(subscription.start_date) : '—'}
                />
                <Row
                  label="Действует до"
                  value={subscription?.end_date ? formatDate(subscription.end_date) : 'Бессрочно'}
                />
              </dl>
            </Card>

            <Card>
              <CardHeader
                title="Сотрудники"
                subtitle="Создание сотрудников и права доступа появятся на следующем этапе"
                action={<Badge>Скоро</Badge>}
              />
              <p className="px-5 py-5 text-[13.5px] leading-relaxed text-muted sm:px-6">
                Модель ролей уже заложена в базе: помимо директора поддерживаются роли
                менеджера и сотрудника, а изоляция данных работает на уровне строк.
                Интерфейс управления командой добавим без изменения схемы.
              </p>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="truncate text-[13.5px] font-medium text-ink">{value}</dd>
    </div>
  );
}
