import type { Metadata } from 'next';
import Link from 'next/link';

import { DateRangePicker } from '@/components/app/date-range-picker';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell, type TableColumn } from '@/components/app/table';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconLeads } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireCompanySession } from '@/lib/auth';
import { takesLeads, type EmployeeRole } from '@/lib/employee-role';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { PLATFORM_LABELS } from '@/lib/labels';
import type { FunnelType } from '@/lib/metrics';
import { currentRange } from '@/lib/period-preference';
import { ClientSearchForm, ClientSearchResults } from './client-search';
import {
  LEADS_PER_PAGE,
  LEADS_PER_PAGE_OPTIONS,
  countUnassignedLeads,
  getAssignableEmployees,
  getCreativeOptions,
  getDepartments,
  getLeadStats,
  getLeads,
  searchClients,
} from '@/lib/queries';
import {
  AddLeadButton,
  DistributeButton,
  LeadOwnerSelect,
  LeadRowActions,
  LeadStatusSelect,
} from './lead-controls';
import { Pagination } from '@/components/app/pagination';
import { DepartmentFilter } from './department-filter';
import { ExportLeadsButton } from './export-button';
import { StatusBreakdown } from './status-breakdown';

/** Лид без первого касания дольше суток — уже потерянные деньги. */
const UNTOUCHED_HOURS = 24;

export const metadata: Metadata = { title: 'Лиды' };

/**
 * Кто ведёт лид и на каком он этапе — главное в этом списке, поэтому четыре
 * ключевые колонки видны всегда, а справочные подключаются по мере ширины
 * экрана. Иначе на ноутбуке «Ответственный» уезжает за правый край.
 */
const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Лид' },
  { key: 'phone', label: 'Телефон', showFrom: 'lg' },
  { key: 'source', label: 'Источник', showFrom: 'md' },
  { key: 'department', label: 'Отдел', showFrom: 'xl' },
  { key: 'creative', label: 'Креатив', showFrom: 'xl' },
  { key: 'owner', label: 'Ответственный' },
  { key: 'created', label: 'Получен', showFrom: 'md' },
  { key: 'status', label: 'Статус' },
  { key: 'actions', label: 'Действия', align: 'right' as const },
];

/** Ширина таблицы для каждого набора видимых колонок. */
const TABLE_MIN_WIDTH = { base: 520, md: 820, lg: 1040, xl: 1400 };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    q?: string;
    department?: string;
    page?: string;
    perPage?: string;
  }>;
}) {
  const { company, employee } = await requireCompanySession();
  const params = await searchParams;
  // Поиск конкретного клиента идёт по всей истории и не зависит от периода:
  // человек звонит сам, а пришёл он мог и полгода назад.
  const query = (params.q ?? '').trim();
  // Менеджер ведёт свои заявки, но не распоряжается чужими: раздача и смена
  // ответственного — работа руководителя.
  const isStaff = employee !== null;
  const range = await currentRange(params, company.timezone);
  const funnelType = company.funnel_type as FunnelType;

  // Отдел из адреса: переключатель ниже оставляет его в ссылке, чтобы выбор
  // переживал смену периода и его можно было отправить руководителю.
  const departmentId = params.department ?? null;

  // Страница и её размер — из адреса: ссылку на нужную страницу можно
  // отправить, и кнопка «назад» в браузере работает сама.
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = LEADS_PER_PAGE_OPTIONS.includes(Number(params.perPage))
    ? Number(params.perPage)
    : LEADS_PER_PAGE;

  const [leadPage, stats, creatives, employees, queued, matches, departments] = await Promise.all([
    getLeads(company.id, range.from, range.to, company.timezone, departmentId, page, perPage),
    getLeadStats(company.id, range.from, range.to, company.timezone, departmentId),
    getCreativeOptions(company.id),
    getAssignableEmployees(company.id),
    countUnassignedLeads(company.id),
    query ? searchClients(company.id, query) : Promise.resolve([]),
    getDepartments(company.id),
  ]);

  const activeDepartments = departments.filter((row) => row.status === 'active');
  const leads = leadPage.items;

  // Лиды раздаются менеджерам: РОП руководит, продажник подключается на пробном.
  const owners = employees
    .filter((employee) => takesLeads(employee.role as EmployeeRole))
    .map((employee) => ({ id: employee.id, name: employee.name }));

  const share = (value: number) => (stats.total ? (value / stats.total) * 100 : 0);

  return (
    <>
      <PageHeader
        title="Лиды"
        description="Каждый лид хранит источник, площадку и креатив — это и есть основа сквозной аналитики."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <ClientSearchForm query={query} />
            <ExportLeadsButton total={leadPage.total} />
            {isStaff ? null : <DistributeButton queued={queued} />}
            <AddLeadButton
              creatives={creatives}
              funnelType={funnelType}
              trialTerm={company.trial_term}
            />
            <DateRangePicker range={range} />
          </div>
        }
      />

      <PageBody>
        {query ? (
          <ClientSearchResults
            query={query}
            matches={matches}
            trialTerm={company.trial_term}
            currency={company.sales_currency}
          />
        ) : (
          <>
            <DepartmentFilter
              departments={activeDepartments}
              selected={departmentId}
              params={params}
            />

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Всего лидов"
                value={formatNumber(stats.total)}
                hint={`${formatNumber(stats.attributed)} с привязкой к креативу`}
              />
              <StatTile
                label="Дозвонились"
                value={formatNumber(stats.reached)}
                hint={`${formatPercent(share(stats.reached))} лидов — живой контакт`}
              />
              <StatTile
                label="Купили"
                value={formatNumber(stats.won)}
                hint={`Конверсия ${formatPercent(share(stats.won))}`}
                accent
              />
              <StatTile
                label="Ждут первого касания"
                value={formatNumber(stats.untouched)}
                hint={
                  queued > 0
                    ? `Без ответственного сейчас: ${formatNumber(queued)} — ждут смены`
                    : `Новые лиды старше ${UNTOUCHED_HOURS} часов — их никто не взял`
                }
              />
            </div>

            {stats.total > 0 ? (
              <Card className="mt-4">
                <CardHeader
                  title="Разбор по статусам"
                  subtitle="Как менеджеры отработали лидов за выбранный период"
                />
                <StatusBreakdown
                  counts={stats.counts}
                  total={stats.total}
                  funnelType={funnelType}
                  trialTerm={company.trial_term}
                />
              </Card>
            ) : null}

            <Card className="mt-4">
              <CardHeader
                title="Список лидов"
                subtitle={
                  stats.total > leads.length
                    ? `Показаны последние ${formatNumber(leads.length)} из ${formatNumber(stats.total)} за ${range.label}`
                    : `Показаны все ${formatNumber(leads.length)} за ${range.label}`
                }
              />
              {leads.length === 0 ? (
                <div className="p-5 sm:p-6">
                  <EmptyState
                    icon={<IconLeads className="size-5" />}
                    title="Лидов за этот период нет"
                    description="Добавьте лид вручную или подключите рекламные кабинеты — тогда заявки будут приходить автоматически."
                    action={
                      <ButtonLink href="/dashboard/integrations" variant="secondary">
                        Настроить интеграции
                      </ButtonLink>
                    }
                  />
                </div>
              ) : (
                <TableShell columns={COLUMNS} minWidth={TABLE_MIN_WIDTH}>
                  {leads.map((lead) => (
                    <tr key={lead.id} className="transition-colors hover:bg-surface-2/60">
                      <Td
                        first
                        truncate="md"
                        title={lead.name || undefined}
                        className="font-medium text-ink"
                      >
                        {lead.name || 'Без имени'}
                      </Td>
                      <Td showFrom="lg" className="tabular text-ink-soft">
                        {lead.phone ?? '—'}
                      </Td>
                      <Td showFrom="md" className="text-ink-soft">
                        {lead.platform
                          ? (PLATFORM_LABELS[lead.platform] ?? lead.platform)
                          : (lead.source ?? '—')}
                      </Td>
                      <Td showFrom="xl" className="text-ink-soft">
                        {lead.departmentName ?? '—'}
                      </Td>
                      <Td
                        showFrom="xl"
                        truncate="sm"
                        title={lead.creativeName ?? undefined}
                        className="text-ink-soft"
                      >
                        {lead.creativeId && lead.creativeName ? (
                          <Link
                            href={`/dashboard/creatives/${lead.creativeId}`}
                            className="whitespace-nowrap text-lime transition-colors hover:text-lime-strong"
                          >
                            {lead.creativeName}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        {isStaff ? (
                          <span className="text-[12.5px] text-ink-soft">
                            {lead.assignedName ?? '—'}
                          </span>
                        ) : (
                          <LeadOwnerSelect
                            leadId={lead.id}
                            assignedTo={lead.assignedTo}
                            employees={owners}
                          />
                        )}
                      </Td>
                      <Td showFrom="md" className="tabular text-muted">
                        {formatDateTime(lead.created_at)}
                      </Td>
                      <Td>
                        <LeadStatusSelect
                          leadId={lead.id}
                          status={lead.status}
                          funnelType={funnelType}
                          trialTerm={company.trial_term}
                        />
                      </Td>
                      <Td last align="right">
                        <LeadRowActions
                          leadId={lead.id}
                          leadName={lead.name}
                          funnelType={funnelType}
                          trialTerm={company.trial_term}
                          status={lead.status}
                          saleAmount={lead.saleAmount}
                          currency={company.sales_currency}
                        />
                      </Td>
                    </tr>
                  ))}
                </TableShell>
              )}
              <Pagination
                page={page}
                total={leadPage.total}
                perPage={perPage}
                perPageOptions={LEADS_PER_PAGE_OPTIONS}
              />
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
