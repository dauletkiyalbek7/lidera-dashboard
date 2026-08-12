import type { Metadata } from 'next';
import Link from 'next/link';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { requireSuperAdmin } from '@/lib/auth';
import { CompanyCreateForm } from './company-create-form';

export const metadata: Metadata = { title: 'Новая компания' };

export default async function NewCompanyPage() {
  await requireSuperAdmin();

  return (
    <>
      <PageHeader
        title="Новая компания"
        description="Платформа создаст компанию, заведёт учётную запись директора и подключит тариф."
        action={
          <Link
            href="/admin"
            className="text-[13.5px] text-muted transition-colors hover:text-ink"
          >
            ← К списку компаний
          </Link>
        }
      />

      <PageBody>
        <div className="max-w-3xl">
          <Card>
            <CardHeader
              title="Данные компании и директора"
              subtitle="После создания директор сразу может войти на /login по своему email"
            />
            <CompanyCreateForm />
          </Card>

          <p className="mt-4 text-[13px] leading-relaxed text-faint">
            Все данные новой компании изолированы: пользователи одной компании технически
            не могут получить строки другой — это гарантируют политики Row Level Security
            в PostgreSQL, а не фильтры в интерфейсе.
          </p>
        </div>
      </PageBody>
    </>
  );
}
