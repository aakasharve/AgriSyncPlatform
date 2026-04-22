import { Mic, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { useOpsVoice } from '@/hooks/useOpsVoice';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { KpiCard } from '@/components/ui/KpiCard';

export default function OpsVoicePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const days = Number(searchParams.get('days') ?? 14);
  const { data, isLoading } = useOpsVoice(days);

  const trend = data?.data?.days ?? [];
  const lastRefreshed = data?.meta?.lastRefreshed;

  const avgSuccess = trend.length
    ? (trend.reduce((s, d) => s + d.successRatePct, 0) / trend.length).toFixed(1)
    : '—';
  const totalInvocations = trend.reduce((s, d) => s + d.invocations, 0);
  const totalFailures = trend.reduce((s, d) => s + d.failures, 0);
  const avgLatency = trend.length
    ? Math.round(trend.reduce((s, d) => s + d.avgLatencyMs, 0) / trend.length)
    : 0;

  function setDays(d: number) {
    setSearchParams((prev) => { prev.set('days', String(d)); return prev; });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-teal to-brand-sky text-white shadow-[0_4px_12px_rgba(82,192,190,0.4)]">
            <Mic size={18} strokeWidth={2.5} />
          </span>
          Voice Pipeline
        </h1>
        <div className="flex items-center gap-2">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold transition-colors ${
                days === d
                  ? 'border-brand-teal bg-surface-kpi text-text-primary'
                  : 'border-surface-border bg-transparent text-text-muted hover:bg-surface-sidebar'
              }`}
            >
              {d}d
            </button>
          ))}
          <FreshnessChip source="live-aggregated" lastRefreshed={lastRefreshed} />
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard
          label="Total Invocations"
          value={isLoading ? '—' : totalInvocations.toLocaleString()}
          icon={<Mic size={16} strokeWidth={2.5} />}
          iconColor="#52c0be"
        />
        <KpiCard
          label="Total Failures"
          value={isLoading ? '—' : totalFailures.toLocaleString()}
          deltaTrend={totalFailures > 0 ? 'down' : 'up'}
          icon={<TrendingUp size={16} strokeWidth={2.5} />}
          iconColor="#dc2626"
        />
        <KpiCard
          label="Avg Success Rate"
          value={isLoading ? '—' : `${avgSuccess}%`}
          deltaTrend={Number(avgSuccess) >= 90 ? 'up' : 'down'}
          icon={<Mic size={16} strokeWidth={2.5} />}
          iconColor="#00c853"
        />
        <KpiCard
          label="Avg Latency"
          value={isLoading ? '—' : `${avgLatency}ms`}
          icon={<TrendingUp size={16} strokeWidth={2.5} />}
          iconColor="#f59e0b"
        />
      </div>

      {/* Success rate chart */}
      <Card>
        <CardHeader>
          <CardTitle>
            <PanelIcon bg="linear-gradient(135deg,var(--color-brand-teal),var(--color-brand-sky))">
              <Mic size={14} strokeWidth={2.5} />
            </PanelIcon>
            Voice Success Rate — last {days} days
          </CardTitle>
          <FreshnessChip source="live-aggregated" lastRefreshed={lastRefreshed} />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[220px] animate-pulse rounded-lg bg-surface-sidebar" />
          ) : trend.length === 0 ? (
            <div className="grid h-[220px] place-items-center text-sm text-text-muted">
              No voice invocations recorded in this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => format(parseISO(v), 'd MMM')}
                  tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: 'var(--color-text-muted)', fontWeight: 600 }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: 'var(--color-text-muted)', fontWeight: 600 }}
                  axisLine={false} tickLine={false} width={40}
                />
                <ReferenceLine y={90} stroke="var(--color-text-muted)" strokeDasharray="4 4" label={{ value: '90% target', fontSize: 11, fill: 'var(--color-text-muted)', fontFamily: 'JetBrains Mono' }} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-panel)',
                    border: '2px solid var(--color-surface-border-strong)',
                    borderRadius: 10,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 12,
                    color: 'var(--color-text-primary)',
                  }}
                  formatter={(v) => [`${v}%`, 'Success rate']}
                  labelFormatter={(l) => format(parseISO(l as string), 'dd MMM yyyy')}
                />
                <Line
                  type="monotone"
                  dataKey="successRatePct"
                  stroke="var(--color-brand-teal)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: 'var(--color-brand-teal)' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Invocations chart */}
      <Card>
        <CardHeader>
          <CardTitle>
            <PanelIcon bg="linear-gradient(135deg,var(--color-brand-green),var(--color-brand-teal))">
              <TrendingUp size={14} strokeWidth={2.5} />
            </PanelIcon>
            Daily Invocations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[180px] animate-pulse rounded-lg bg-surface-sidebar" />
          ) : trend.length === 0 ? (
            <div className="grid h-[180px] place-items-center text-sm text-text-muted">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => format(parseISO(v), 'd MMM')}
                  tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: 'var(--color-text-muted)', fontWeight: 600 }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: 'var(--color-text-muted)', fontWeight: 600 }}
                  axisLine={false} tickLine={false} width={40}
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
                  labelFormatter={(l) => format(parseISO(l as string), 'dd MMM yyyy')}
                />
                <Line type="monotone" dataKey="invocations" stroke="var(--color-brand-green)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="failures" stroke="var(--color-danger)" strokeWidth={2} strokeDasharray="4 2" dot={false} />
              </LineChart>
            </ResponsiveContainer>
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
