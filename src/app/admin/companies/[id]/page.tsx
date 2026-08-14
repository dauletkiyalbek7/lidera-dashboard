import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';
import { getCapiSettings, getCompany, getCompanyAdAccounts } from '@/lib/admin-queries';
import { requireSuperAdmin } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/format';
import { COMPANY_STATUS, PLAN_LABELS, ROLE_LABELS, statusOf } from '@/lib/labels';
import { listMetaAccounts, observeCompany } from '../../actions';
import { AdAccountForm, AdAccountList } from './ad-account-form';
import { CapiForm } from './capi-form';
import {
  CompanyEditForm,
  CompanyStatusToggle,
  DirectorCreateForm,
} from './company-edit-form';

export const metadata: Metadata = { title: 'Компания' };

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();

  const { id } = await params;
  const result = await getCompany(id);
  if (!result) notFound();

  const { company, members, subscription, counts } = result;
  const status = statusOf(COMPANY_STATUS, company.status);
  const meta = await listMetaAccounts();
  const attached = await getCompanyAdAccounts(company.id);
  const capi = await getCapiSettings(company.id);

  return (
    <>
      <PageHeader
        title={company.name}
        description={`Создана ${formatDate(company.created_at)}${
          company.is_demo ? ' · демонстрационная компания' : ''
        }`}
        action={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Badge tone={status.tone}>{status.label}</Badge>
            <form action={observeCompany.bind(null, company.id)}>
              <Button type="submit" variant="secondary" size="field">
                Открыть кабинет
              </Button>
            </form>
            <Link
              href="/admin"
              className="text-[13.5px] text-muted transition-colors hover:text-ink"
            >
              ← К списку
            </Link>
          </div>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile label="Лиды" value={formatNumber(counts.leads)} />
          <StatTile label="Продажи" value={formatNumber(counts.sales)} />
          <StatTile label="Креативы" value={formatNumber(counts.creatives)} />
          <StatTile
            label="Тариф"
            value={subscription ? (PLAN_LABELS[subscription.plan] ?? subscription.plan) : '—'}
            accent
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Реквизиты компании" />
            <CompanyEditForm
              companyId={company.id}
              defaults={{
                name: company.name,
                directorName: company.director_name ?? '',
                phone: company.phone ?? '',
                status: company.status,
                funnelType: company.funnel_type,
              }}
            />
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Пользователи компании"
                subtitle={`Всего: ${formatNumber(members.length)}`}
              />
              {members.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted sm:px-6">
                  У компании ещё нет пользователей.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {members.map((member) => (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-ink">
                          {member.name || 'Без имени'}
                        </p>
                        <p className="mt-0.5 truncate text-[12.5px] text-faint">
                          {member.email ?? '—'}
                        </p>
                      </div>
                      <Badge tone={member.status === 'active' ? 'neutral' : 'negative'}>
                        {ROLE_LABELS[member.role] ?? member.role}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Добавить директора"
                subtitle="Создаст учётную запись и привяжет её к этой компании"
              />
              <DirectorCreateForm companyId={company.id} />
            </Card>

            <Card>
              <CardHeader
                title="Рекламный кабинет Meta"
                subtitle="Откуда компания берёт расход, кампании и креативы"
              />
              <AdAccountList companyId={company.id} accounts={attached} />
              <div className="border-t border-line">
                <AdAccountForm
                  companyId={company.id}
                  accounts={meta.accounts}
                  error={meta.error}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Покупки в Meta (CAPI)"
                subtitle="Оплата курса уходит в рекламный кабинет — реклама учится на покупателях"
              />
              <CapiForm companyId={company.id} current={capi} />
            </Card>

            <Card>
              <CardHeader title="Доступ компании" />
              <CompanyStatusToggle
                companyId={company.id}
                isActive={company.status !== 'inactive'}
              />
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
