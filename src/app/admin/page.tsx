import type { Metadata } from 'next';
import Link from 'next/link';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconCompanies, IconPlus } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { listCompanies } from '@/lib/admin-queries';
import { formatDate, formatNumber } from '@/lib/format';
import { COMPANY_STATUS, PLAN_LABELS, statusOf } from '@/lib/labels';

export const metadata: Metadata = { title: 'Компании' };

const COLUMNS = [
  { key: 'name', label: 'Компания' },
  { key: 'director', label: 'Директор' },
  { key: 'plan', label: 'Тариф' },
  { key: 'leads', label: 'Лиды', align: 'right' as const },
  { key: 'sales', label: 'Продажи', align: 'right' as const },
  { key: 'created', label: 'Создана', align: 'right' as const },
  { key: 'status', label: 'Статус', align: 'right' as const },
];

export default async function AdminCompaniesPage() {
  const companies = await listCompanies();

  const active = companies.filter((company) => company.status === 'active').length;
  const demo = companies.filter((company) => company.is_demo).length;

  return (
    <>
      <PageHeader
        title="Компании"
        description="Все подключённые к платформе компании. Данные каждой изолированы на уровне базы."
        action={
          <ButtonLink href="/admin/companies/new">
            <IconPlus className="size-4" />
            Добавить компанию
          </ButtonLink>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Всего компаний" value={formatNumber(companies.length)} />
          <StatTile label="Активных" value={formatNumber(active)} accent />
          <StatTile
            label="Демонстрационных"
            value={formatNumber(demo)}
            hint="Отделены флагом is_demo и не смешиваются с боевыми данными"
          />
        </div>

        <Card className="mt-4">
          <CardHeader title="Список компаний" />
          {companies.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconCompanies className="size-5" />}
                title="Компаний пока нет"
                description="Создайте первую компанию — платформа заведёт её директора и выдаст доступ в кабинет."
                action={
                  <ButtonLink href="/admin/companies/new">Добавить компанию</ButtonLink>
                }
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={920}>
              {companies.map((company) => {
                const status = statusOf(COMPANY_STATUS, company.status);
                return (
                  <tr key={company.id} className="transition-colors hover:bg-surface-2/60">
                    <Td first>
                      <Link
                        href={`/admin/companies/${company.id}`}
                        className="font-medium text-ink transition-colors hover:text-lime"
                      >
                        {company.name}
                      </Link>
                      {company.is_demo ? (
                        <span className="ml-2 rounded-full border border-line-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint">
                          demo
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-ink-soft">
                      {company.director_name ?? '—'}
                      <span className="mt-0.5 block text-[12px] text-faint">
                        {company.directors} чел.
                      </span>
                    </Td>
                    <Td className="text-ink-soft">
                      {company.plan ? (PLAN_LABELS[company.plan] ?? company.plan) : '—'}
                    </Td>
                    <Td align="right" className="tabular text-ink-soft">
                      {formatNumber(company.leads)}
                    </Td>
                    <Td align="right" className="tabular text-ink-soft">
                      {formatNumber(company.sales)}
                    </Td>
                    <Td align="right" className="tabular text-muted">
                      {formatDate(company.created_at)}
                    </Td>
                    <Td last align="right">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </TableShell>
          )}
        </Card>
      </PageBody>
    </>
  );
}
