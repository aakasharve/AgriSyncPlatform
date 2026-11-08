import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Calendar, CheckCircle, ClipboardCheck, XCircle } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';

// spec: plr-d10 lane SCH-A (Task 5) - the library as the server serves it (GET /shramsafal/reference/schedule-templates, the same
// read the phone's library uses), with each row's check state. This page used to call a route the server does not serve
// (/shramsafal/reference-data/crop-schedule-templates), so it listed nothing.
interface LibraryCheck {
  state: 'Checked' | 'NotChecked' | 'Returned' | 'Withdrawn';
  checkerDisplayName: string | null;
  checkedAtUtc: string | null;
  note: string | null;
}

interface LibraryTemplate {
  id: string;
  name: string;
  cropType: string;
  totalDays: number;
  stages: Array<{ name: string; startDay: number; endDay: number }>;
  activities: Array<{ name: string }>;
  ownerType: string | null;
  sourceLabel: string | null;
  check: LibraryCheck | null;
  rowVersionTag: string | null;
  hasStoredDays: boolean | null;
}

function stateOf(t: LibraryTemplate): { label: string; tone: string } {
  switch (t.check?.state) {
    case 'Checked':
      return { label: 'Checked', tone: 'var(--color-brand-green)' };
    case 'Returned':
      return { label: 'Returned', tone: '#ea580c' };
    case 'Withdrawn':
      return { label: 'Withdrawn', tone: '#dc2626' };
    default:
      return { label: t.hasStoredDays ? 'Not checked' : 'Not checkable (days not stored)', tone: 'var(--color-text-muted)' };
  }
}

export default function ScheduleTemplatesPage() {
  const { data: templates, isLoading } = useQuery<LibraryTemplate[]>({
    queryKey: ['schedules', 'templates'],
    queryFn: async () => {
      const { data } = await adminApi.get<LibraryTemplate[]>('/shramsafal/reference/schedule-templates');
      return data;
    },
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-teal to-brand-sky text-white shadow-[0_4px_12px_rgba(82,192,190,0.35)]"><Calendar size={18} strokeWidth={2.5}/></span>
          Schedule Templates
        </h1>
        <div className="flex items-center gap-3">
          <Link to="/schedules/check" className="inline-flex items-center gap-1.5 rounded-md border-2 border-surface-border-strong px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-panel">
            <ClipboardCheck size={14} strokeWidth={2.5}/> Schedules waiting for a check
          </Link>
          <FreshnessChip source="live" />
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({length:6}).map((_,i)=><div key={i} className="h-32 animate-pulse rounded-xl bg-surface-sidebar"/>)}
        </div>
      )}

      {!isLoading && !templates?.length && (
        <div className="glass-panel py-16 text-center text-sm text-text-muted">
          No schedule templates found.
        </div>
      )}

      {!isLoading && !!templates?.length && (
        <div className="grid grid-cols-3 gap-4">
          {templates.map(t => {
            const state = stateOf(t);
            return (
              <Card key={t.id}>
                <CardHeader>
                  <CardTitle>
                    <span className="inline-grid h-6 w-6 place-items-center rounded-[7px] text-white bg-gradient-to-br from-brand-teal to-brand-sky"><Calendar size={14} strokeWidth={2.5}/></span>
                    {t.name}
                  </CardTitle>
                  {t.check?.state === 'Checked'
                    ? <CheckCircle size={16} className="text-brand-green" strokeWidth={2.5}/>
                    : <XCircle size={16} className="text-text-muted" strokeWidth={2.5}/>}
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-text-muted font-medium">Crop</span>
                      <span className="font-semibold text-text-primary">{t.cropType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted font-medium">Version</span>
                      <span className="font-mono text-[12px] font-bold text-text-primary">{t.rowVersionTag ?? '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted font-medium">Source</span>
                      <span className="max-w-[60%] truncate text-right font-semibold text-text-primary">{t.sourceLabel ?? t.ownerType ?? '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted font-medium">Tasks</span>
                      <span className="font-mono text-[14px] font-bold text-text-primary">{t.activities.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted font-medium">Duration</span>
                      <span className="font-mono text-[12px] font-bold text-text-primary">{t.totalDays}d</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{color: state.tone}}>
                      {t.check?.state === 'Checked' ? <CheckCircle size={12}/> : <XCircle size={12}/>}
                      {state.label}
                      {t.check?.state === 'Checked' && t.check.checkerDisplayName ? ` - ${t.check.checkerDisplayName}` : ''}
                    </div>
                    {t.hasStoredDays && (
                      <Link to={`/schedules/check?id=${t.id}`} className="mt-1 text-[12px] font-bold text-brand-teal hover:underline">
                        Open in the check page
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
