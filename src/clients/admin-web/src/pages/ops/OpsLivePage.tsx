import { Zap, AlertTriangle, Mic, Frown, CheckCircle, XCircle } from 'lucide-react';
import { useOpsHealth } from '@/hooks/useOpsHealth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { KpiCard } from '@/components/ui/KpiCard';
import { format } from 'date-fns';

export default function OpsLivePage() {
  const { data, isLoading, error, dataUpdatedAt } = useOpsHealth();
  const lastRefreshed = dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-green to-brand-teal text-white shadow-[0_4px_12px_rgba(0,200,83,0.35)]">
            <Zap size={18} strokeWidth={2.5} />
          </span>
          Live Health
        </h1>
        <FreshnessChip source="live" lastRefreshed={lastRefreshed} />
      </div>

      {error && (
        <div className="glass-panel border-danger/40 p-4 text-sm font-semibold text-danger">
          Backend unreachable. Start the .NET API on port 5001.
        </div>
      )}

      {/* Alert state */}
      <div className="grid grid-cols-2 gap-3.5">
        <AlertBadge
          label="R9 · API Error Spike"
          breached={data?.apiErrorSpike}
          loading={isLoading}
        />
        <AlertBadge
          label="R10 · Voice Degraded"
          breached={data?.voiceDegraded}
          loading={isLoading}
        />
      </div>

      {/* Voice stats 4 cards */}
      <SectionLabel title="Voice Pipeline — last 24h" />
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard
          label="Invocations"
          value={isLoading ? '—' : (data?.voiceInvocations24h ?? 0)}
          icon={<Mic size={16} strokeWidth={2.5} />}
          iconColor="#52c0be"
        />
        <KpiCard
          label="Failures"
          value={isLoading ? '—' : (data?.voiceFailures24h ?? 0)}
          deltaTrend={data && data.voiceFailures24h > 0 ? 'down' : 'up'}
          icon={<AlertTriangle size={16} strokeWidth={2.5} />}
          iconColor="#dc2626"
        />
        <KpiCard
          label="Failure Rate"
          value={isLoading ? '—' : `${data?.voiceFailureRatePct ?? 0}%`}
          deltaTrend={data && data.voiceFailureRatePct > 10 ? 'down' : 'up'}
          icon={<Mic size={16} strokeWidth={2.5} />}
          iconColor="#52c0be"
        />
        <KpiCard
          label="P95 Latency"
          value={isLoading ? '—' : `${data?.voiceP95LatencyMs ?? 0}ms`}
          icon={<Zap size={16} strokeWidth={2.5} />}
          iconColor="#f59e0b"
        />
      </div>

      {/* Recent errors table */}
      <SectionLabel title="Recent Errors (last 2h)" />
      <Card>
        <CardHeader>
          <CardTitle>
            <PanelIcon bg="linear-gradient(135deg,#f59e0b,#dc2626)">
              <AlertTriangle size={14} strokeWidth={2.5} />
            </PanelIcon>
            Error Events
          </CardTitle>
          <FreshnessChip source="live" lastRefreshed={lastRefreshed} />
        </CardHeader>
        <CardContent>
          {isLoading && <TableSkeleton />}
          {!isLoading && (!data?.recentErrors?.length) && (
            <EmptyState icon={<CheckCircle size={40} strokeWidth={1.5} />} label="No errors in the last 2 hours" />
          )}
          {!isLoading && !!data?.recentErrors?.length && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Endpoint</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Latency</th>
                  <th className="py-2">Farm</th>
                </tr>
              </thead>
              <tbody>
                {data.recentErrors.map((e, i) => (
                  <tr key={i} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                    <td className="py-2 pr-3 font-mono text-[12px] font-semibold text-text-muted">
                      {format(new Date(e.occurredAtUtc), 'HH:mm:ss')}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${
                        e.eventType === 'api.error' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-text-primary'
                      }`}>
                        {e.eventType}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-[12px] font-semibold text-text-primary">{e.endpoint}</td>
                    <td className="py-2 pr-3 font-mono text-[13px] font-bold text-text-primary">{e.statusCode ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-[12px] text-text-muted">{e.latencyMs ? `${e.latencyMs}ms` : '—'}</td>
                    <td className="py-2 font-mono text-[11px] text-text-muted">{e.farmId ? e.farmId.slice(0, 8) + '…' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Farmer suffering watchlist */}
      <Card>
        <CardHeader>
          <CardTitle>
            <PanelIcon bg="linear-gradient(135deg,#ea580c,#dc2626)">
              <Frown size={14} strokeWidth={2.5} />
            </PanelIcon>
            Farmer Suffering Watchlist
          </CardTitle>
          <FreshnessChip source="live" lastRefreshed={lastRefreshed} />
        </CardHeader>
        <CardContent>
          {isLoading && <TableSkeleton rows={4} />}
          {!isLoading && (!data?.topSufferingFarms?.length) && (
            <EmptyState icon={<CheckCircle size={40} strokeWidth={1.5} />} label="No farms with repeated errors in last 24h" />
          )}
          {!isLoading && !!data?.topSufferingFarms?.length && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
                  <th className="py-2 pr-3">Farm ID</th>
                  <th className="py-2 pr-3">Total Errors</th>
                  <th className="py-2 pr-3">Sync</th>
                  <th className="py-2 pr-3">Logs</th>
                  <th className="py-2 pr-3">Voice</th>
                  <th className="py-2">Last Error</th>
                </tr>
              </thead>
              <tbody>
                {data.topSufferingFarms.map((f, i) => (
                  <tr key={i} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                    <td className="py-2 pr-3 font-mono text-[12px] font-semibold text-text-primary">{f.farmId.slice(0, 8)}…</td>
                    <td className="py-2 pr-3 font-mono text-[16px] font-extrabold text-danger">{f.errorCount}</td>
                    <td className="py-2 pr-3 font-mono text-[13px] font-bold text-text-muted">{f.syncErrors}</td>
                    <td className="py-2 pr-3 font-mono text-[13px] font-bold text-text-muted">{f.logErrors}</td>
                    <td className="py-2 pr-3 font-mono text-[13px] font-bold text-text-muted">{f.voiceErrors}</td>
                    <td className="py-2 font-mono text-[12px] text-text-muted">
                      {format(new Date(f.lastErrorAt), 'HH:mm')}
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

function AlertBadge({ label, breached, loading }: { label: string; breached?: boolean | null; loading: boolean }) {
  const color = loading ? 'bg-surface-sidebar border-surface-border text-text-muted'
    : breached === true ? 'bg-danger/15 border-danger/40 text-danger'
    : 'bg-success/12 border-success/40 text-[#064e20]';
  const Icon = breached === true ? XCircle : CheckCircle;
  return (
    <div className={`glass-kpi flex items-center gap-3 px-5 py-4 ${color}`}>
      <Icon size={22} strokeWidth={2.5} />
      <span className="text-[14px] font-bold">{label}</span>
      <span className="ml-auto font-mono text-[13px] font-extrabold">
        {loading ? '…' : breached === true ? 'BREACH' : breached === false ? 'CLEAR' : 'N/A'}
      </span>
    </div>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div className="px-1 pt-1 text-[13px] font-extrabold uppercase tracking-[0.09em] text-text-primary">
      {title}
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

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-surface-sidebar" />
      ))}
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-text-muted">
      {icon}
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}
