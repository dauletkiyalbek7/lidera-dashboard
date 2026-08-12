import { Badge } from '@/components/ui/badge';
import { formatMoney, formatNumber, formatRatio } from '@/lib/format';
import {
  FUNNEL_LABELS,
  middleStepValue,
  verdictByRoas,
  verdictLabels,
  type FunnelType,
} from '@/lib/metrics';
import type { CreativePerformance } from '@/lib/queries';

const PLATFORM_LABELS: Record<string, string> = {
  meta: 'Meta',
  tiktok: 'TikTok',
  google: 'Google',
  other: 'Другое',
};

const VERDICT_TONE = {
  excellent: 'positive',
  good: 'positive',
  weak: 'warning',
  bad: 'negative',
} as const;

/**
 * Сквозная таблица «креатив → деньги».
 * Строки отсортированы по выручке, а не по количеству лидов — в этом вся мысль.
 */
export function CreativeTable({
  creatives,
  funnelType,
  limit,
}: {
  creatives: CreativePerformance[];
  funnelType: FunnelType;
  limit?: number;
}) {
  const rows = limit ? creatives.slice(0, limit) : creatives;
  const middleColumn = FUNNEL_LABELS[funnelType].middleColumn;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-[13.5px]">
        <thead className="border-b border-line text-[12.5px] text-muted">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium sm:px-6">Креатив</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Расход</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Лиды</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">CPL</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">{middleColumn}</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Продажи</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Выручка</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">ROAS</th>
            <th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">Оценка</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((creative) => {
            const verdict = verdictByRoas(creative.roas);
            return (
              <tr key={creative.id} className="transition-colors hover:bg-surface-2/60">
                <th scope="row" className="px-5 py-3.5 text-left font-normal sm:px-6">
                  <span className="block font-medium text-ink">{creative.name}</span>
                  <span className="mt-0.5 block text-[12px] text-faint">
                    {PLATFORM_LABELS[creative.platform] ?? creative.platform}
                    {creative.format ? ` · ${creative.format}` : ''}
                  </span>
                </th>
                <td className="tabular px-3 py-3.5 text-right text-ink-soft">
                  {formatMoney(creative.spend, { compact: true })}
                </td>
                <td className="tabular px-3 py-3.5 text-right text-ink-soft">
                  {formatNumber(creative.leads)}
                </td>
                <td className="tabular px-3 py-3.5 text-right text-ink-soft">
                  {formatMoney(creative.cpl)}
                </td>
                <td className="tabular px-3 py-3.5 text-right text-ink-soft">
                  {formatNumber(middleStepValue(funnelType, creative))}
                </td>
                <td className="tabular px-3 py-3.5 text-right text-ink-soft">
                  {formatNumber(creative.sales)}
                </td>
                <td className="tabular px-3 py-3.5 text-right font-medium text-ink">
                  {formatMoney(creative.revenue, { compact: true })}
                </td>
                <td className="tabular px-3 py-3.5 text-right font-medium text-ink">
                  {formatRatio(creative.roas)}
                </td>
                <td className="px-5 py-3.5 text-right sm:px-6">
                  <Badge tone={VERDICT_TONE[verdict]}>{verdictLabels[verdict]}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
