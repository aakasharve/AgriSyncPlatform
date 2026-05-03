import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import type { CohortScoreBinDto } from '../farmer-health.types';
import { EmptyState } from './EmptyAndErrorStates';

/**
 * Mode B score distribution histogram (DWC v2 §4.4 component #3).
 *
 * 10-point buckets ("0-10" … "91-100"), color-ramped through the bucket
 * thresholds (intervention <= 40, watchlist 41–60, healthy 61+). The
 * "healthy" bins use a neutral teal — never bright green (per C7).
 *
 * a11y: behind a `<details>` we render the same data as a table for
 * screen-reader access (per C10).
 */

export interface ScoreDistributionChartProps {
  bins: CohortScoreBinDto[];
}

const FIXED_BINS = ['0-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100'];

function bucketColor(label: string): string {
  // parse first integer in label for threshold colouring
  const lo = parseInt(label.split('-')[0] ?? '0', 10);
  if (lo <= 40) return '#dc2626';        // intervention — destructive red
  if (lo <= 60) return '#f59e0b';        // watchlist — amber
  return '#52c0be';                      // healthy — neutral teal (NOT bright green per C7)
}

export function ScoreDistributionChart({ bins }: ScoreDistributionChartProps) {
  // Normalise to fixed 10-bin shape so empty bins render as zero columns.
  const map = new Map(bins.map(b => [b.bucket, b.count]));
  const data = FIXED_BINS.map(label => ({ bucket: label, count: map.get(label) ?? 0 }));
  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return <EmptyState message="Not enough data yet — check back in 7 days." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 10, fontFamily: 'DM Sans', fill: 'var(--color-text-muted)', fontWeight: 600 }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fontFamily: 'DM Sans', fill: 'var(--color-text-muted)', fontWeight: 600 }}
            axisLine={false} tickLine={false} width={32}
          />
          <Tooltip
            contentStyle={{
              fontFamily: 'DM Sans', fontSize: 12, borderRadius: 8,
              border: '1px solid var(--color-surface-border)',
              background: 'var(--color-surface-glass, #ffffff)',
            }}
            formatter={(v) => [`${typeof v === 'number' ? v : 0} farms`, 'count']}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map(d => (
              <Cell key={d.bucket} fill={bucketColor(d.bucket)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <details className="text-[11px] text-text-muted">
        <summary className="cursor-pointer">Show data table</summary>
        <table className="mt-2 w-full font-mono text-[11px] tabular-nums">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-1 pr-3">Bucket</th>
              <th className="py-1 pr-3 text-right">Farms</th>
            </tr>
          </thead>
          <tbody>
            {data.map(d => (
              <tr key={d.bucket}>
                <td className="py-0.5 pr-3">{d.bucket}</td>
                <td className="py-0.5 pr-3 text-right">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
