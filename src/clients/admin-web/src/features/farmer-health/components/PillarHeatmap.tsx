import type { CohortPillarHeatmapDto } from '../farmer-health.types';
import { EmptyState } from './EmptyAndErrorStates';

/**
 * Mode B pillar heatmap (DWC v2 §4.4 component #5).
 *
 * Six rows — one per DWC v2 pillar — showing the cohort-average pillar
 * score plus a "failing N farms" badge (count of farms < 50% of the
 * pillar's weight). Bar fill is proportional to avgScore / pillarMax.
 *
 * Pillar weights (per ADR-2026-05-04):
 *   triggerFit 10, actionSimplicity 20, proof 25, reward 10,
 *   investment 10, repeat 25
 */

const PILLAR_LABELS: Record<string, { label: string; max: number }> = {
  triggerFit:       { label: 'Trigger fit',       max: 10 },
  actionSimplicity: { label: 'Action simplicity', max: 20 },
  proof:            { label: 'Proof',             max: 25 },
  reward:           { label: 'Reward',            max: 10 },
  investment:       { label: 'Investment',        max: 10 },
  repeat:           { label: 'Repeat',            max: 25 },
};

const PILLAR_ORDER = ['triggerFit', 'actionSimplicity', 'proof', 'reward', 'investment', 'repeat'] as const;

function fillColor(ratio: number): string {
  if (ratio < 0.5) return '#dc2626';   // intervention red
  if (ratio < 0.75) return '#f59e0b';  // amber
  return '#52c0be';                     // neutral teal — never bright green (C7)
}

export interface PillarHeatmapProps {
  rows: CohortPillarHeatmapDto[];
}

export function PillarHeatmap({ rows }: PillarHeatmapProps) {
  if (rows.length === 0) {
    return <EmptyState message="Not enough data yet — check back in 7 days." />;
  }

  // Index by pillar key for fixed ordering. Missing pillars render as zero.
  const map = new Map(rows.map(r => [r.pillar, r]));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2.5" role="list" aria-label="Pillar heatmap">
        {PILLAR_ORDER.map(key => {
          const meta = PILLAR_LABELS[key];
          const row = map.get(key);
          const avg = row?.avgScore ?? 0;
          const ratio = meta.max > 0 ? Math.min(1, Math.max(0, avg / meta.max)) : 0;
          const failing = row?.failingFarmsCount ?? 0;
          return (
            <div key={key} role="listitem" className="flex items-center gap-3 text-[12px]">
              <div className="w-32 truncate font-semibold text-text-primary">{meta.label}</div>
              <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-sidebar">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${ratio * 100}%`, background: fillColor(ratio) }}
                />
              </div>
              <div className="w-16 text-right font-mono text-[11px] font-bold tabular-nums text-text-primary">
                {avg.toFixed(1)}<span className="text-text-muted"> / {meta.max}</span>
              </div>
              <div
                className={`w-24 text-right font-mono text-[11px] tabular-nums ${failing > 0 ? 'font-bold text-danger' : 'text-text-muted'}`}
                aria-label={`${failing} farms failing this pillar`}
              >
                {failing > 0 ? `${failing} failing` : '—'}
              </div>
            </div>
          );
        })}
      </div>

      <details className="text-[11px] text-text-muted">
        <summary className="cursor-pointer">Show data table</summary>
        <table className="mt-2 w-full font-mono text-[11px] tabular-nums">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-1 pr-3">Pillar</th>
              <th className="py-1 pr-3 text-right">Avg</th>
              <th className="py-1 pr-3 text-right">Max</th>
              <th className="py-1 pr-3 text-right">Failing</th>
            </tr>
          </thead>
          <tbody>
            {PILLAR_ORDER.map(key => {
              const row = map.get(key);
              const meta = PILLAR_LABELS[key];
              return (
                <tr key={key}>
                  <td className="py-0.5 pr-3">{meta.label}</td>
                  <td className="py-0.5 pr-3 text-right">{(row?.avgScore ?? 0).toFixed(1)}</td>
                  <td className="py-0.5 pr-3 text-right">{meta.max}</td>
                  <td className="py-0.5 pr-3 text-right">{row?.failingFarmsCount ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
