import { formatNumber, formatPercent } from '@/lib/format';
import { safeDivide } from '@/lib/metrics';

export type FunnelStep = {
  label: string;
  value: number;
};

/**
 * Воронка Реклама → Лид → Пробный → Продажа.
 * Одна серия магнитуды: длина полосы кодирует значение, цвет — постоянный.
 * Ramp по величине здесь был бы двойным кодированием одного и того же.
 */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const peak = Math.max(1, ...steps.map((step) => step.value));

  return (
    <ol className="space-y-4 px-5 py-5 sm:px-6">
      {steps.map((step, index) => {
        const previous = index === 0 ? null : steps[index - 1];
        const share = safeDivide(step.value, peak) * 100;
        const stepConversion = previous
          ? safeDivide(step.value, previous.value) * 100
          : null;

        return (
          <li key={step.label}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[13.5px] text-ink-soft">{step.label}</span>
              <span className="tabular text-[15px] font-semibold text-ink">
                {formatNumber(step.value)}
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-series-revenue"
                style={{ width: `${Math.max(share, 1.5)}%` }}
                title={`${step.label}: ${formatNumber(step.value)}`}
              />
            </div>
            {stepConversion !== null ? (
              <p className="mt-1.5 text-[12px] text-faint">
                Переход из «{previous!.label}» — {formatPercent(stepConversion)}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
