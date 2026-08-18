import { Badge, StatusDot } from '@/components/ui/badge';
import { formatNumber, formatPercent } from '@/lib/format';
import {
  leadStatusFor,
  leadStatusesFor,
  type LeadStatus,
  type LeadStatusTone,
} from '@/lib/lead-status';
import type { FunnelType } from '@/lib/metrics';

const barTone: Record<LeadStatusTone, string> = {
  neutral: 'bg-line-strong',
  positive: 'bg-positive',
  warning: 'bg-warning',
  negative: 'bg-negative',
  lime: 'bg-lime',
};

/**
 * Разбор по статусам: сколько лидов застряло на каждом шаге.
 * Именно эта таблица отвечает на вопрос «как отработал менеджер» —
 * доля недозвонов и отказов видна сразу, без выгрузки в Excel.
 */
export function StatusBreakdown({
  counts,
  total,
  funnelType,
  trialTerm,
}: {
  counts: Record<string, number>;
  total: number;
  funnelType: FunnelType;
  /** Как компания зовёт промежуточный шаг: подпись статуса берётся отсюда. */
  trialTerm: string;
}) {
  // Показываем шаги воронки компании в их естественном порядке. Статус вне
  // набора (остался от прежней настройки) не прячем — иначе цифры не сойдутся.
  const known = leadStatusesFor(funnelType);
  const extra = Object.keys(counts).filter(
    (status) => !known.includes(status as LeadStatus) && counts[status] > 0,
  ) as LeadStatus[];

  const rows = [...known, ...extra]
    .map((status) => ({ status, count: counts[status] ?? 0 }))
    .filter((row) => row.count > 0);

  if (rows.length === 0) return null;

  return (
    <div className="divide-y divide-line">
      {rows.map(({ status, count }) => {
        const meta = leadStatusFor(status, trialTerm);
        const share = total > 0 ? (count / total) * 100 : 0;

        return (
          <div
            key={status}
            className="flex items-center gap-3 px-5 py-3 sm:gap-4 sm:px-6"
          >
            <div className="w-[128px] shrink-0 sm:w-[150px]">
              <Badge tone={meta.tone}>
                <StatusDot tone={meta.tone} />
                {meta.label}
              </Badge>
            </div>

            <p className="hidden flex-1 text-[12.5px] text-faint lg:block">{meta.hint}</p>

            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3 lg:max-w-[200px]">
              <div
                className={`h-full rounded-full ${barTone[meta.tone]}`}
                style={{ width: `${Math.max(share, 1.5)}%` }}
              />
            </div>

            <p className="tabular w-12 shrink-0 text-right text-[13.5px] font-medium text-ink">
              {formatNumber(count)}
            </p>
            <p className="tabular w-14 shrink-0 text-right text-[12.5px] text-muted">
              {formatPercent(share)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
