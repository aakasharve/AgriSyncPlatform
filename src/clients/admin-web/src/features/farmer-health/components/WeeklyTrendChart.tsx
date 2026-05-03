import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, parseISO } from 'date-fns';
import type { CohortWeeklyTrendDto } from '../farmer-health.types';
import { EmptyState } from './EmptyAndErrorStates';

/**
 * Mode B weekly trend (DWC v2 §4.4 component #6).
 *
 * 8-week line chart of cohort average DWC score with farm count plotted
 * on a secondary axis (right). Score axis uses the existing teal token;
 * farm count uses a muted neutral so the score stays visually dominant.
 *
 * a11y: data table behind `<details>` (per C10).
 */

export interface WeeklyTrendChartProps {
  weeks: CohortWeeklyTrendDto[];
}

export function WeeklyTrendChart({ weeks }: WeeklyTrendChartProps) {
  if (weeks.length === 0) {
    return <EmptyState message="Not enough data yet — check back in 7 days." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis
            dataKey="weekStart"
            tickFormatter={(v: string) => {
              try { return format(parseISO(v), 'MMM d'); } catch { return v; }
            }}
            tick={{ fontSize: 10, fontFamily: 'DM Sans', fill: 'var(--color-text-muted)', fontWeight: 600 }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            yAxisId="score"
            domain={[0, 100]}
            tick={{ fontSize: 10, fontFamily: 'DM Sans', fill: 'var(--color-text-muted)', fontWeight: 600 }}
            axisLine={false} tickLine={false} width={28}
          />
          <YAxis
            yAxisId="count"
            orientation="right"
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
            labelFormatter={(l) => {
              try { return format(parseISO(String(l)), 'dd MMM yyyy'); } catch { return String(l); }
            }}
            formatter={(v, n) => {
              const num = typeof v === 'number' ? v : 0;
              return [
                n === 'avgScore' ? `${num.toFixed(1)}` : `${num} farms`,
                n === 'avgScore' ? 'Avg score' : 'Farm count',
              ];
            }}
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="avgScore"
            stroke="#52c0be"
            strokeWidth={2.4}
            dot={{ r: 3, strokeWidth: 0, fill: '#52c0be' }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            yAxisId="count"
            type="monotone"
            dataKey="farmCount"
            stroke="var(--color-text-muted)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <details className="text-[11px] text-text-muted">
        <summary className="cursor-pointer">Show data table</summary>
        <table className="mt-2 w-full font-mono text-[11px] tabular-nums">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-1 pr-3">Week</th>
              <th className="py-1 pr-3 text-right">Avg score</th>
              <th className="py-1 pr-3 text-right">Farms</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.weekStart}>
                <td className="py-0.5 pr-3">{w.weekStart}</td>
                <td className="py-0.5 pr-3 text-right">{w.avgScore.toFixed(1)}</td>
                <td className="py-0.5 pr-3 text-right">{w.farmCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
