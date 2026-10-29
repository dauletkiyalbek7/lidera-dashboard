import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

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
import { Logo } from '@/components/ui/logo';
import { buildRnp, findSharedProject, resolveMonth } from '@/lib/rnp';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'РНП',
  // Ссылка секретная: поисковикам её знать незачем.
  robots: { index: false, follow: false },
};

/**
 * Открытый РНП одного проекта — без входа, по ссылке с ключом.
 *
 * Руководителю и команде так проще: ссылку кидают в чат, и она открывается с
 * телефона без логина. Ключ подписан номером проекта, поэтому ссылка не
 * открывает ни соседние проекты, ни чужие с похожим названием.
 */
export default async function SharedRnpPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ key?: string; month?: string }>;
}) {
  const { project: slug } = await params;
  const { key, month: requestedMonth } = await searchParams;

  const company = await findSharedProject(slug, key);
  if (!company) notFound();

  const timezone = company.timezone ?? 'Asia/Almaty';
  const month = resolveMonth(requestedMonth, timezone);
  const rnp = await buildRnp([company], month);
  const project = rnp.projects[0];
  const isCurrent = month === resolveMonth(undefined, timezone);

  const hrefFor = (target: string) =>
    `/rnp/${slug}?${new URLSearchParams({ key: key ?? '', month: target })}`;

  return (
    <div className="theme-light min-h-dvh bg-base">
      <div className="border-b border-line px-5 py-4 sm:px-8">
        <Logo href="/" />
      </div>

      <PageHeader
        title={`РНП · ${company.name}`}
        description="Реклама по дням за месяц. Обновляется сама каждые два часа."
        action={<RnpMonthNav month={month} isCurrent={isCurrent} hrefFor={hrefFor} />}
      />

      <PageBody>
        {!project || !hasActivity(project.total) ? (
          <EmptyState
            icon={<IconReports className="size-5" />}
            title={`За ${monthLabel(month).toLowerCase()} цифр нет`}
            description="Реклама в этом месяце не крутилась. Выберите другой месяц стрелками выше."
          />
        ) : (
          <div className="flex flex-col gap-6">
            <RnpSummary total={project.total} projects={rnp.projects} />
            <RnpProjectTable project={project} days={rnp.days} today={rnp.today} />
            <RnpNote isCurrent={isCurrent} />
          </div>
        )}
      </PageBody>
    </div>
  );
}
