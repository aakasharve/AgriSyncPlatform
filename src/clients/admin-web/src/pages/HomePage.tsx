import {
  ShieldCheck,
  AlertTriangle,
  Mic,
  FileText,
  Activity,
  Wheat,
  UserCheck,
  Coins,
  Clock,
  TrendingUp,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { KpiCard } from '@/components/ui/KpiCard';

export default function HomePage() {
  const now = new Date().toISOString();
  const lastNightly = new Date(Date.now() - 14 * 3600 * 1000).toISOString();

  return (
    <div className="flex flex-col gap-5">
      <SectionLabel
        title="Ops Now"
        meta={<FreshnessChip source="live" lastRefreshed={now} />}
        iconBg="linear-gradient(135deg, var(--color-brand-green), var(--color-brand-teal))"
        icon={<Activity size={13} strokeWidth={2.5} />}
      />
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard
          label="Active Alerts"
          value={0}
          deltaTrend="up"
          note="all R1–R10 clear"
          icon={<ShieldCheck size={16} strokeWidth={2.5} />}
          iconColor="#22c55e"
        />
        <KpiCard
          label="API Errors 24h"
          value={'—'}
          note="awaiting live data"
          icon={<AlertTriangle size={16} strokeWidth={2.5} />}
          iconColor="#dc2626"
        />
        <KpiCard
          label="Voice Success 24h"
          value={'—'}
          note="awaiting live data"
          icon={<Mic size={16} strokeWidth={2.5} />}
          iconColor="#52c0be"
        />
        <KpiCard
          label="Logs Today"
          value={'—'}
          note="awaiting live data"
          icon={<FileText size={16} strokeWidth={2.5} />}
          iconColor="#00c853"
        />
      </div>

      <SectionLabel
        title="Business this week"
        meta={<FreshnessChip source="materialized" lastRefreshed={lastNightly} />}
        iconBg="linear-gradient(135deg, #f59e0b, #00c853)"
        icon={<TrendingUp size={13} strokeWidth={2.5} />}
      />
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard
          label="WVFD · goal 4.5"
          value={'—'}
          note="awaiting MIS data"
          icon={<Activity size={16} strokeWidth={2.5} />}
          iconColor="#7c3aed"
        />
        <KpiCard
          label="Active Farms"
          value={'—'}
          note="awaiting MIS data"
          icon={<Wheat size={16} strokeWidth={2.5} />}
          iconColor="#329128"
        />
        <KpiCard
          label="D30 Retention"
          value={'—'}
          note="awaiting MIS data"
          icon={<UserCheck size={16} strokeWidth={2.5} />}
          iconColor="#0ea5e9"
        />
        <KpiCard
          label="MRR"
          value={'—'}
          note="awaiting MIS data"
          icon={<Coins size={16} strokeWidth={2.5} />}
          iconColor="#f59e0b"
        />
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <PanelIcon bg="linear-gradient(135deg, var(--color-brand-mint), var(--color-brand-sky))">
                <Clock size={14} strokeWidth={2.5} />
              </PanelIcon>
              Recent Activity
            </CardTitle>
            <FreshnessChip source="live" lastRefreshed={now} />
          </CardHeader>
          <CardContent>
            <EmptyRow label="No activity yet — Phase 2 wires this to /admin/ops/health" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <PanelIcon bg="linear-gradient(135deg, #f59e0b, #dc2626)">
                <AlertTriangle size={14} strokeWidth={2.5} />
              </PanelIcon>
              Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyRow label="Wired in Phase 2" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <PanelIcon bg="linear-gradient(135deg, #7c3aed, #00c853)">
              <Activity size={14} strokeWidth={2.5} />
            </PanelIcon>
            WVFD — last 12 weeks
          </CardTitle>
          <FreshnessChip source="materialized" lastRefreshed={lastNightly} />
        </CardHeader>
        <CardContent>
          <div className="grid h-[200px] place-items-center rounded-lg border border-dashed border-surface-border text-sm text-text-muted">
            Chart renders in Phase 3 · wires to mis.wvfd_weekly
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionLabel({
  title,
  meta,
  iconBg,
  icon,
}: {
  title: string;
  meta: React.ReactNode;
  iconBg: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-1 pt-1">
      <h3 className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-[0.09em] text-text-primary">
        <span
          className="grid h-[22px] w-[22px] place-items-center rounded-md text-white"
          style={{ background: iconBg }}
        >
          {icon}
        </span>
        {title}
      </h3>
      {meta}
    </div>
  );
}

function PanelIcon({
  bg,
  children,
}: {
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-grid h-6 w-6 flex-shrink-0 place-items-center rounded-[7px] text-white"
      style={{ background: bg }}
    >
      {children}
    </span>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="py-3 text-sm text-text-muted">
      {label}
    </div>
  );
}
