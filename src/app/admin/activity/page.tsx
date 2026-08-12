import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell } from '@/components/app/table';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconReceipts } from '@/components/ui/icons';
import { listAuditLogs } from '@/lib/admin-queries';
import { requireSuperAdmin } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Журнал действий' };

const COLUMNS = [
  { key: 'action', label: 'Действие' },
  { key: 'company', label: 'Компания' },
  { key: 'entity', label: 'Объект' },
  { key: 'date', label: 'Когда', align: 'right' as const },
];

const ACTION_LABELS: Record<string, string> = {
  'company.created': 'Создана компания',
  'company.updated': 'Изменены реквизиты компании',
  'company.status_changed': 'Изменён статус компании',
  'director.created': 'Создан директор',
  'demo.seeded': 'Загружены демо-данные',
};

export default async function ActivityPage() {
  await requireSuperAdmin();
  const logs = await listAuditLogs();

  return (
    <>
      <PageHeader
        title="Журнал действий"
        description="Административные операции платформы. Записи создаются только на сервере."
      />

      <PageBody>
        <Card>
          <CardHeader title="Последние события" subtitle="До 100 записей" />
          {logs.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconReceipts className="size-5" />}
                title="Событий пока нет"
                description="Здесь появятся создание компаний, смена статусов и выдача доступов."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={720}>
              {logs.map((log) => (
                <tr key={log.id} className="transition-colors hover:bg-surface-2/60">
                  <Td first className="font-medium text-ink">
                    {ACTION_LABELS[log.action] ?? log.action}
                  </Td>
                  <Td className="text-ink-soft">{log.companyName ?? '—'}</Td>
                  <Td className="text-muted">{log.entity_type ?? '—'}</Td>
                  <Td last align="right" className="tabular text-muted">
                    {formatDateTime(log.created_at)}
                  </Td>
                </tr>
              ))}
            </TableShell>
          )}
        </Card>
      </PageBody>
    </>
  );
}
