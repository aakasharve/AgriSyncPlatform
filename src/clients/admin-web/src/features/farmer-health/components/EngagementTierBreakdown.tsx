import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CohortEngagementTierDto, EngagementTier } from '../farmer-health.types';
import { EmptyState } from './EmptyAndErrorStates';

/**
 * Mode B engagement-tier breakdown donut (DWC v2 §4.4 component #4).
 *
 * Shows A/B/C/D split with percentage. Uses the existing admin-web tier
 * palette (matches FarmsListPage / NorthStarPage). a11y data-table behind
 * `<details>` per C10.
 */

const TIER_COLOR: Record<EngagementTier, string> = {
  A: '#00c853',  // existing admin-web brand-green token; pre-existing tier color
  B: '#52c0be',
  C: '#f59e0b',
  D: '#dc2626',
};

const TIER_ORDER: EngagementTier[] = ['A', 'B', 'C', 'D'];

export interface EngagementTierBreakdownProps {
  tiers: CohortEngagementTierDto[];
}

export function EngagementTierBreakdown({ tiers }: EngagementTierBreakdownProps) {
  // Normalise to fixed A/B/C/D order with zero-fill for missing tiers.
  const map = new Map<EngagementTier, number>(
    tiers.map(t => [t.tier, t.count] as const),
  );
  const data = TIER_ORDER.map(t => ({ tier: t, count: map.get(t) ?? 0 }));
  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return <EmptyState message="Not enough data yet — check back in 7 days." />;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[180px] w-[180px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="tier"
              innerRadius={48}
              outerRadius={78}
              stroke="var(--color-surface-glass, #ffffff)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map(d => (
                <Cell key={d.tier} fill={TIER_COLOR[d.tier]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                fontFamily: 'DM Sans', fontSize: 12, borderRadius: 8,
                border: '1px solid var(--color-surface-border)',
                background: 'var(--color-surface-glass, #ffffff)',
              }}
              formatter={(v, _n, item) => {
                const num = typeof v === 'number' ? v : 0;
                const pct = total > 0 ? ((num / total) * 100).toFixed(0) : '0';
                const tier = (item as { payload?: { tier?: string } } | undefined)?.payload?.tier ?? '';
                return [`${num} farms · ${pct}%`, `Tier ${tier}`];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="font-mono text-[20px] font-extrabold tabular-nums text-text-primary">{total}</div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-text-muted">farms</div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        {data.map(d => {
          const pct = total > 0 ? (d.count / total) * 100 : 0;
          return (
            <div key={d.tier} className="flex items-center gap-2 text-[12px]">
              <span className="grid h-5 w-6 place-items-center rounded text-[11px] font-extrabold text-white" style={{ background: TIER_COLOR[d.tier] }}>
                {d.tier}
              </span>
              <span className="font-mono text-[12px] font-bold tabular-nums text-text-primary w-10 text-right">{d.count}</span>
              <span className="font-mono text-[11px] tabular-nums text-text-muted w-12 text-right">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>

      <details className="sr-only">
        <summary>Show data table</summary>
        <table>
          <thead>
            <tr><th>Tier</th><th>Farms</th><th>%</th></tr>
          </thead>
          <tbody>
            {data.map(d => (
              <tr key={d.tier}>
                <td>{d.tier}</td><td>{d.count}</td>
                <td>{total > 0 ? ((d.count / total) * 100).toFixed(0) : '0'}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
