import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import {
  hasActivity,
  monthLabel,
  RnpMonthNav,
  RnpNote,
  RnpProjectTable,
  RnpSummary,
} from '@/components/app/rnp-table';
import { EmptyState } from '@/components/ui/empty-state';
import { IconReports } from '@/components/ui/icons';
import { requireAdsAccess } from '@/lib/auth';
import { addDay, buildRnp, emptyDay, resolveMonth } from '@/lib/rnp';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'РНП' };

/**
 * РНП по месяцам: каждый проект — таблица, показатели в строках, дни в
 * колонках, итог месяца справа. Так же устроен РНП, который команда вела
 * руками, — чтобы не переучиваться.
 *
 * Директору, у которого несколько проектов (русский, английский, вакансии),
 * показываем их все сразу: ради общей картины страница и нужна. Таргетологу —
 * только текущий проект. Открытая ссылка на один проект — /rnp/[project].
 */
export default async function RnpPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const context = await requireAdsAccess();
  const { company } = context;
  const timezone = company.timezone ?? 'Asia/Almaty';

  const month = resolveMonth((await searchParams).month, timezone);
  const companies = await visibleCompanies(context);
  const rnp = await buildRnp(companies, month);

  const total = emptyDay();
  for (const project of rnp.projects) addDay(total, project.total);

  const isCurrent = month === resolveMonth(undefined, timezone);

  return (
    <>
      <PageHeader
        title="РНП"
        description="Реклама по дням за месяц. Заполняется сама: платформа забирает цифры из кабинета каждые два часа."
        action={
          <RnpMonthNav
            month={month}
            isCurrent={isCurrent}
            hrefFor={(target) => `/dashboard/rnp?month=${target}`}
          />
        }
      />

      <PageBody>
        {rnp.projects.length === 0 || !hasActivity(total) ? (
          <EmptyState
            icon={<IconReports className="size-5" />}
            title={`За ${monthLabel(month).toLowerCase()} цифр нет`}
            description="Реклама в этом месяце не крутилась или кабинет ещё не подключён. Выберите другой месяц стрелками выше."
          />
        ) : (
          <div className="flex flex-col gap-6">
            <RnpSummary total={total} projects={rnp.projects} />
            {rnp.projects.map((project) => (
              <RnpProjectTable key={project.id} project={project} days={rnp.days} today={rnp.today} />
            ))}
            <RnpNote isCurrent={isCurrent} />
          </div>
        )}
      </PageBody>
    </>
  );
}

/**
 * Какие проекты показать.
 *
 * Текущий — всегда. Остальные — только те, где у этого входа профиль
 * директора: сотрудник другого проекта не должен видеть его рекламу, даже
 * если вход один. Администратор платформы смотрит только открытый кабинет.
 */
async function visibleCompanies(context: Awaited<ReturnType<typeof requireAdsAccess>>) {
  const { company } = context;
  const own = [{ id: company.id, name: company.name, timezone: company.timezone, currency: company.currency }];

  if (context.readOnly || context.employee || context.companies.length < 2) return own;

  const supabase = await createServerSupabase();
  const { data: profiles } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('user_id', context.userId)
    .eq('status', 'active')
    .eq('role', 'DIRECTOR');

  const ids = (profiles ?? [])
    .map((row) => row.company_id)
    .filter((id): id is string => id !== null && id !== company.id);
  if (ids.length === 0) return own;

  const { data: others } = await supabase
    .from('companies')
    .select('id, name, timezone, currency')
    .in('id', ids);

  return [...own, ...(others ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}
