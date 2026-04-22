import { useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import { Activity, TrendingUp, TrendingDown, Minus, Star } from 'lucide-react';
import { useWvfd } from '@/hooks/useWvfd';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';

const TIER_COLORS: Record<string, string> = {
  A: '#00c853', B: '#52c0be', C: '#f59e0b', D: '#dc2626',
};
const TIER_BG: Record<string, string> = {
  A: 'rgba(0,200,83,0.15)', B: 'rgba(82,192,190,0.15)',
  C: 'rgba(245,158,11,0.15)', D: 'rgba(220,38,38,0.12)',
};

export default function NorthStarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const weeks = Number(searchParams.get('weeks') ?? 12);
  const { data, isLoading } = useWvfd(weeks);

  const h = data?.data;
  const lastRefreshed = data?.meta?.lastRefreshed;
  const delta = h && h.priorWvfd != null ? +(h.currentWvfd - h.priorWvfd).toFixed(2) : null;
  const trend = delta === null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? '#00c853' : trend === 'down' ? '#dc2626' : '#888';

  const goalPct = h ? Math.min(100, (h.currentWvfd / h.goalWvfd) * 100) : 0;

  function setWeeks(w: number) {
    setSearchParams((p) => { p.set('weeks', String(w)); return p; });
  }

  // Tier distribution
  const tierCounts = (h?.topFarms ?? []).reduce<Record<string, number>>((acc, f) => {
    acc[f.engagementTier] = (acc[f.engagementTier] ?? 0) + 1;
    return acc;
  }, {});
  const totalFarms = Object.values(tierCounts).reduce((s, v) => s + v, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-[0_4px_12px_rgba(124,58,237,0.4)]"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#00c853)' }}>
            <Star size={18} strokeWidth={2.5} />
          </span>
          North Star · WVFD
        </h1>
        <div className="flex items-center gap-2">
          {[8, 12, 24].map((w) => (
            <button
              key={w}
              onClick={() => setWeeks(w)}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold transition-colors ${
                weeks === w
                  ? 'border-brand-teal bg-surface-kpi text-text-primary'
                  : 'border-surface-border bg-transparent text-text-muted hover:bg-surface-sidebar'
              }`}
            >
              {w}w
            </button>
          ))}
          <FreshnessChip source="materialized" lastRefreshed={lastRefreshed} />
        </div>
      </div>

      {/* Hero row: big number + goal bar */}
      <div className="grid grid-cols-[auto_1fr] gap-4">
        {/* Big number */}
        <div className="glass-kpi flex flex-col justify-center gap-2 px-8 py-7">
          <div className="text-[13px] font-bold uppercase tracking-[0.09em] text-text-muted">
            Weekly Verified Farm-Days / Farm
          </div>
          <div className="flex items-end gap-4">
            <span className="font-mono text-[72px] font-extrabold leading-none tracking-[-0.04em] text-text-primary">
              {isLoading ? '—' : (h?.currentWvfd?.toFixed(1) ?? '0.0')}
            </span>
            {!isLoading && delta !== null && (
              <span className="mb-2 flex items-center gap-1 font-mono text-[22px] font-bold"
                style={{ color: trendColor }}>
                <TrendIcon size={22} strokeWidth={2.5} />
                {delta > 0 ? '+' : ''}{delta?.toFixed(2)}
              </span>
            )}
          </div>
          <div className="text-[13px] font-semibold text-text-muted">
            vs last week &nbsp;·&nbsp; goal{' '}
            <span className="font-mono font-bold text-text-primary">
              {h?.goalWvfd.toFixed(1) ?? '4.5'}
            </span>
            /wk
          </div>
        </div>

        {/* Goal progress */}
        <div className="glass-kpi flex flex-col justify-center gap-4 px-8 py-7">
          <div className="text-[13px] font-bold uppercase tracking-[0.09em] text-text-muted">
            Progress to goal
          </div>
          <div className="h-5 w-full overflow-hidden rounded-full bg-surface-sidebar">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${isLoading ? 0 : goalPct}%`,
                background: goalPct >= 100
                  ? 'var(--color-brand-green)'
                  : goalPct >= 75
                  ? 'linear-gradient(90deg,var(--color-brand-teal),var(--color-brand-green))'
                  : goalPct >= 50
                  ? 'linear-gradient(90deg,#f59e0b,var(--color-brand-teal))'
                  : 'linear-gradient(90deg,#dc2626,#f59e0b)',
              }}
            />
          </div>
          <div className="flex justify-between font-mono text-[13px] font-bold text-text-muted">
            <span>0</span>
            <span className="text-text-primary">{goalPct.toFixed(0)}% of {h?.goalWvfd.toFixed(1) ?? '4.5'}</span>
            <span>{h?.goalWvfd.toFixed(1) ?? '4.5'}</span>
          </div>

          {/* Tier chips */}
          {totalFarms > 0 && (
            <div className="flex gap-2 flex-wrap">
              {(['A', 'B', 'C', 'D'] as const).map((t) => (
                <div
                  key={t}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold"
                  style={{ background: TIER_BG[t], color: TIER_COLORS[t] }}
                >
                  <span>Tier {t}</span>
                  <span className="font-mono">{tierCounts[t] ?? 0}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* WVFD trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>
            <PanelIcon bg="linear-gradient(135deg,#7c3aed,#00c853)">
              <Activity size={14} strokeWidth={2.5} />
            </PanelIcon>
            WVFD — last {weeks} weeks
          </CardTitle>
          <FreshnessChip source="materialized" lastRefreshed={lastRefreshed} />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[260px] animate-pulse rounded-lg bg-surface-sidebar" />
          ) : !h?.weeks.length ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={h.weeks} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="wvfdGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="10%" stopColor="#7c3aed" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#00c853" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis
                  dataKey="weekStart"
                  tickFormatter={(v) => format(parseISO(v), 'MMM d')}
                  tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: 'var(--color-text-muted)', fontWeight: 600 }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  domain={[0, 7]}
                  ticks={[0, 1, 2, 3, 4, 4.5, 5, 6, 7]}
                  tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: 'var(--color-text-muted)', fontWeight: 600 }}
                  axisLine={false} tickLine={false} width={32}
                />
                <ReferenceLine
                  y={4.5}
                  stroke="#00c853"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  label={{ value: '4.5 goal', position: 'insideTopRight', fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#00c853', fontWeight: 700 }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-panel)',
                    border: '2px solid var(--color-surface-border-strong)',
                    borderRadius: 10,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 12,
                    color: 'var(--color-text-primary)',
                  }}
                  formatter={(v) => [typeof v === 'number' ? v.toFixed(2) : v, 'WVFD']}
                  labelFormatter={(l) => `Week of ${format(parseISO(l as string), 'dd MMM yyyy')}`}
                />
                <Area
                  type="monotone"
                  dataKey="avgWvfd"
                  stroke="url(#wvfdLineGrad)"
                  fill="url(#wvfdGrad)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: '#7c3aed' }}
                />
                <defs>
                  <linearGradient id="wvfdLineGrad" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="#7c3aed" />
                    <stop offset="100%" stopColor="#00c853" />
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-farm breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>
            <PanelIcon bg="linear-gradient(135deg,var(--color-brand-green),var(--color-brand-teal))">
              <TrendingUp size={14} strokeWidth={2.5} />
            </PanelIcon>
            Per-Farm Breakdown (latest week)
          </CardTitle>
          <span className="text-sm text-text-muted">{h?.topFarms.length ?? 0} farms</span>
        </CardHeader>
        <CardContent>
          {isLoading && <TableSkeleton />}
          {!isLoading && !h?.topFarms.length && (
            <EmptyChart label="No farms in mis.wvfd_weekly yet" />
          )}
          {!isLoading && !!h?.topFarms.length && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
                  <th className="py-2 pr-3">Farm ID</th>
                  <th className="py-2 pr-3">Tier</th>
                  <th className="py-2 pr-3">WVFD</th>
                  <th className="py-2">Bar</th>
                </tr>
              </thead>
              <tbody>
                {h.topFarms.map((f, i) => (
                  <tr key={i} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                    <td className="py-2.5 pr-3 font-mono text-[12px] font-semibold text-text-primary">
                      {f.farmId.slice(0, 8)}…
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                        style={{ background: TIER_BG[f.engagementTier], color: TIER_COLORS[f.engagementTier] }}
                      >
                        {f.engagementTier}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[15px] font-bold text-text-primary">
                      {f.wvfd.toFixed(1)}
                    </td>
                    <td className="py-2.5 w-full max-w-[180px]">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sidebar">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (f.wvfd / 7) * 100)}%`,
                            background: TIER_COLORS[f.engagementTier],
                            opacity: 0.75,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PanelIcon({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <span className="inline-grid h-6 w-6 flex-shrink-0 place-items-center rounded-[7px] text-white" style={{ background: bg }}>
      {children}
    </span>
  );
}
function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-surface-sidebar" />
      ))}
    </div>
  );
}
function EmptyChart({ label = 'No data in mis.wvfd_weekly yet' }: { label?: string }) {
  return (
    <div className="grid h-[200px] place-items-center rounded-lg border border-dashed border-surface-border text-sm text-text-muted">
      {label}
    </div>
  );
}
