import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { requireFullAccess } from '@/lib/auth';
import { EMPLOYEE_ROLE, employeeRolesFor } from '@/lib/employee-role';
import type { FunnelType } from '@/lib/metrics';
import { AccessMatrix } from './access-matrix';

export const metadata: Metadata = { title: 'Права доступа' };

/**
 * Кто что видит — одной таблицей.
 *
 * Страница ничего не настраивает: доступы решают роль и политики базы. Она
 * отвечает на вопрос «что увидит новый сотрудник», чтобы это можно было
 * посмотреть, а не проверять входом под чужим логином.
 */
export default async function AccessPage() {
  const { company } = await requireFullAccess();
  const funnelType = company.funnel_type as FunnelType;
  const trialTerm = company.trial_term ?? 'trial';

  return (
    <>
      <PageHeader
        title="Права доступа"
        description="Что видит каждая роль. Меняется вместе с ролью сотрудника в разделе «Команда»."
      />

      <PageBody>
        <Card>
          <CardHeader
            title="Разделы и роли"
            subtitle="Галочка — раздел в меню; подпись под ней — какая часть данных открыта"
          />
          <AccessMatrix funnelType={funnelType} trialTerm={trialTerm} />
        </Card>

        <Card className="mt-4">
          <CardHeader
            title="Роли"
            subtitle="Чем занят каждый — это же описание видно при добавлении сотрудника"
          />
          <ul className="grid gap-3 px-5 py-5 sm:px-6">
            <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[14.5px] font-medium text-ink">Директор</span>
              <span className="text-[13.5px] text-ink-soft">
                — видит и меняет всё: деньги, рекламу, команду и настройки проекта.
              </span>
            </li>
            {employeeRolesFor(funnelType).map((role) => (
              <li key={role} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[14.5px] font-medium text-ink">
                  {EMPLOYEE_ROLE[role].label}
                </span>
                <span className="text-[13.5px] text-ink-soft">
                  — {EMPLOYEE_ROLE[role].hint.toLowerCase()}.
                </span>
              </li>
            ))}
          </ul>
          <p className="px-5 pb-5 text-[12.5px] leading-relaxed text-faint sm:px-6">
            Таблица показывает правила, а не хранит их. Доступ к самим данным держат
            политики базы: чужую заявку сотрудник не получит, даже если наберёт адрес
            раздела руками.
          </p>
        </Card>
      </PageBody>
    </>
  );
}
