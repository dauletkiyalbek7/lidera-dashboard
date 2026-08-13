import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Td, TableShell } from '@/components/app/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconReceipts } from '@/components/ui/icons';
import { requireCompanySession } from '@/lib/auth';
import { formatDate, formatMoney } from '@/lib/format';
import { getReceipts } from '@/lib/queries';

export const metadata: Metadata = { title: 'Чеки' };

const COLUMNS = [
  { key: 'phone', label: 'Телефон' },
  { key: 'amount', label: 'Сумма' },
  { key: 'date', label: 'Дата чека' },
  { key: 'source', label: 'Источник' },
  { key: 'status', label: 'Проверка', align: 'right' as const },
];

const VERIFICATION: Record<string, { label: string; tone: 'positive' | 'warning' | 'negative' }> = {
  pending: { label: 'На проверке', tone: 'warning' },
  verified: { label: 'Подтверждён', tone: 'positive' },
  rejected: { label: 'Отклонён', tone: 'negative' },
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Загружен вручную',
  telegram: 'Telegram-бот',
  api: 'API',
};

export default async function ReceiptsPage() {
  const { company } = await requireCompanySession();
  const currency = company.currency;
  const receipts = await getReceipts(company.id);

  return (
    <>
      <PageHeader
        title="Чеки"
        description="Подтверждение оплат: чеки, суммы и связь с продажей."
      />

      <PageBody>
        <Card>
          <CardHeader title="Загруженные чеки" subtitle="Последние 100 записей" />
          {receipts.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconReceipts className="size-5" />}
                title="Чеков пока нет"
                description="Как только менеджеры начнут присылать чеки, они появятся здесь — с суммой, датой и привязкой к продаже."
              />
            </div>
          ) : (
            <TableShell columns={COLUMNS} minWidth={720}>
              {receipts.map((receipt) => {
                const status = VERIFICATION[receipt.verification_status] ?? {
                  label: receipt.verification_status,
                  tone: 'warning' as const,
                };
                return (
                  <tr key={receipt.id} className="transition-colors hover:bg-surface-2/60">
                    <Td first className="tabular font-medium text-ink">
                      {receipt.phone ?? '—'}
                    </Td>
                    <Td className="tabular text-ink-soft">
                      {formatMoney(Number(receipt.amount), { currency })}
                    </Td>
                    <Td className="tabular text-ink-soft">
                      {receipt.receipt_date ? formatDate(receipt.receipt_date) : '—'}
                    </Td>
                    <Td className="text-ink-soft">
                      {SOURCE_LABELS[receipt.source] ?? receipt.source}
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
