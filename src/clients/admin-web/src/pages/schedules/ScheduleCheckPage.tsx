import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';

// spec: plr-d10 lane SCH-A (Task 5; founder D-74, L8-R) - ShramSafal's check of a library schedule, day by day.
// A check is a ShramSafal PLATFORM act: the server records who checked (the signed-in person), when, and which version. This page
// only ever sends the decision, the ticked rows, the note and the name farmers read. Approve needs EVERY row ticked (R4): the
// checker ticks each activity with its days, repeat, part, role and "after" order (R34, D-104a). Return and Withdraw need a reason.

interface WaitingSchedule {
  id: string;
  name: string;
  version: number;
  cropKey: string | null;
  ownerType: string | null;
  sourceLabel: string | null;
  stageCount: number;
  activityCount: number;
  createdAtUtc: string;
}

interface CheckActivity {
  id: string | null;
  name: string;
  stageName: string;
  startDay: number;
  endDay: number;
  frequencyMode: string;
  intervalDays: number | null;
  part: string | null;
  operationKey: string | null;
  role: string | null;
  nutrientKey: string | null;
  afterActivityId: string | null;
  storedFrequencyMode: string | null;
}

interface CheckSchedule {
  id: string;
  name: string;
  cropType: string;
  totalDays: number;
  stages: Array<{ name: string; startDay: number; endDay: number }>;
  activities: CheckActivity[];
  ownerType: string | null;
  sourceLabel: string | null;
  rowVersionTag: string | null;
  hasStoredDays: boolean | null;
  check: { state: string; checkerDisplayName: string | null; checkedAtUtc: string | null; note: string | null } | null;
}

// PROPOSED (Marathi): what farmers read before the checker's own name.
const DEFAULT_CHECKER_NAME = 'श्रमसफल कृषी तज्ज्ञ ';

function repeatText(a: CheckActivity): string {
  if (a.storedFrequencyMode === 'EveryNDays') return `every ${a.intervalDays ?? '?'} days`;
  if (a.storedFrequencyMode === 'PerWeek') return `${a.intervalDays ?? '?'} per week`;
  if (a.storedFrequencyMode === 'OneTime') return 'once';
  return 'not stored';
}

function errorText(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string; error?: string } } } | null)?.response;
  if (response?.status === 403) return 'You do not hold the schedule review seat.';
  return response?.data?.message ?? response?.data?.error ?? 'The check was not recorded.';
}

export default function ScheduleCheckPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const queryClient = useQueryClient();

  const waiting = useQuery<WaitingSchedule[]>({
    queryKey: ['schedules', 'check', 'waiting'],
    queryFn: async () => {
      const { data } = await adminApi.get<WaitingSchedule[]>('/shramsafal/schedule-templates/checks/waiting');
      return data;
    },
    staleTime: 15_000,
  });

  const schedule = useQuery<CheckSchedule>({
    queryKey: ['schedules', 'check', 'one', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data } = await adminApi.get<CheckSchedule>(`/shramsafal/reference/schedule-templates/${selectedId}`);
      return data;
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-teal to-brand-sky text-white shadow-[0_4px_12px_rgba(82,192,190,0.35)]"><ClipboardCheck size={18} strokeWidth={2.5}/></span>
          Schedule check
        </h1>
        <FreshnessChip source="live" />
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-4">
        <Card>
          <CardHeader><CardTitle>Waiting for a check</CardTitle></CardHeader>
          <CardContent>
            {waiting.isLoading && <div className="h-16 animate-pulse rounded-xl bg-surface-sidebar"/>}
            {waiting.isError && <p className="text-sm text-danger">{errorText(waiting.error)}</p>}
            {!waiting.isLoading && !waiting.isError && !waiting.data?.length && (
              <p className="text-sm text-text-muted">Nothing is waiting. A schedule waits here once its days are stored and nobody has decided on it.</p>
            )}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {(waiting.data ?? []).map(w => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => setParams({ id: w.id })}
                    className={`w-full rounded-lg border-2 px-3 py-2 text-left text-sm ${selectedId === w.id ? 'border-brand-teal bg-surface-panel' : 'border-surface-border bg-surface-glass'}`}
                  >
                    <span className="block font-bold text-text-primary">{w.name}</span>
                    <span className="block text-[12px] text-text-muted">
                      v{w.version} - {w.stageCount} stages - {w.activityCount} activities{w.sourceLabel ? ` - ${w.sourceLabel}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div>
          {!selectedId && <div className="glass-panel py-16 text-center text-sm text-text-muted">Pick a schedule to check it day by day.</div>}
          {selectedId && schedule.isLoading && <div className="h-40 animate-pulse rounded-xl bg-surface-sidebar"/>}
          {selectedId && schedule.isError && <div className="glass-panel py-10 text-center text-sm text-danger">{errorText(schedule.error)}</div>}
          {selectedId && schedule.data && (
            <CheckForm
              key={schedule.data.id}
              schedule={schedule.data}
              onDone={() => {
                void queryClient.invalidateQueries({ queryKey: ['schedules'] });
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CheckForm({ schedule, onDone }: { schedule: CheckSchedule; onDone: () => void }) {
  const rows = useMemo(
    () => [...schedule.activities].sort((a, b) => a.startDay - b.startDay || a.name.localeCompare(b.name)),
    [schedule.activities],
  );
  const nameById = useMemo(() => new Map(rows.map(r => [r.id, r.name] as const)), [rows]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [checkerName, setCheckerName] = useState(DEFAULT_CHECKER_NAME);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const storable = schedule.hasStoredDays === true && rows.every(r => r.id !== null);
  const allTicked = storable && rows.length > 0 && rows.every(r => r.id !== null && ticked.has(r.id));
  const named = checkerName.trim().length > 0;
  const hasNote = note.trim().length > 0;

  const record = useMutation({
    mutationFn: async (decision: 'Approved' | 'Returned' | 'Withdrawn') => {
      const { data } = await adminApi.post(`/shramsafal/schedule-templates/${schedule.id}/check`, {
        decision,
        checkedActivityIds: decision === 'Approved' ? [...ticked] : [],
        note: decision === 'Approved' ? null : note.trim(),
        checkerDisplayName: checkerName.trim(),
      });
      return { data, decision };
    },
    onSuccess: ({ decision }) => {
      setMessage({ ok: true, text: `Recorded: ${decision}.` });
      onDone();
    },
    onError: (error: unknown) => setMessage({ ok: false, text: errorText(error) }),
  });

  function toggle(id: string) {
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{schedule.name}</CardTitle>
        <span className="font-mono text-[12px] font-bold text-text-muted">{schedule.rowVersionTag ?? ''}</span>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-muted">
          <span>Crop: <b className="text-text-primary">{schedule.cropType}</b></span>
          <span>Source: <b className="text-text-primary">{schedule.sourceLabel ?? schedule.ownerType ?? '-'}</b></span>
          <span>Total days: <b className="text-text-primary">{schedule.totalDays}</b></span>
          <span>Now: <b className="text-text-primary">{schedule.check?.state ?? 'NotChecked'}</b>{schedule.check?.checkerDisplayName ? ` - ${schedule.check.checkerDisplayName}` : ''}</span>
        </div>
        <p className="mb-3 text-[12px] text-text-muted">
          Stages: {schedule.stages.map(s => `${s.name} (${s.startDay}-${s.endDay})`).join(' | ')}
        </p>

        {!storable && (
          <p className="mb-3 rounded-md bg-surface-sidebar p-3 text-sm text-danger">
            The days of this schedule are not stored, so it cannot be checked.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
                {['Checked', 'Activity', 'Stage', 'Days', 'Repeat', 'Part', 'Operation', 'Role', 'After'].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id ?? r.name} className="border-b border-row-divider">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`Checked: ${r.name}`}
                      disabled={r.id === null}
                      checked={r.id !== null && ticked.has(r.id)}
                      onChange={() => r.id !== null && toggle(r.id)}
                    />
                  </td>
                  <td className="py-2 pr-3 font-semibold text-text-primary">{r.name}</td>
                  <td className="py-2 pr-3">{r.stageName}</td>
                  <td className="py-2 pr-3 font-mono text-[12px]">{r.startDay}-{r.endDay}</td>
                  <td className="py-2 pr-3">{repeatText(r)}</td>
                  <td className="py-2 pr-3">{r.part ?? '-'}</td>
                  <td className="py-2 pr-3 font-mono text-[12px]">{r.operationKey ?? '-'}</td>
                  <td className="py-2 pr-3">{r.role ? `${r.role}${r.nutrientKey ? ` (${r.nutrientKey})` : ''}` : '-'}</td>
                  <td className="py-2 pr-3">{r.afterActivityId ? `after ${nameById.get(r.afterActivityId) ?? '?'}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold text-text-primary">
            Name farmers read
            <input
              type="text"
              value={checkerName}
              onChange={e => setCheckerName(e.target.value)}
              className="w-full max-w-md rounded-md border-2 border-surface-border bg-surface-kpi px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-teal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-text-primary">
            Reason (needed for Return and Withdraw)
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              className="w-full max-w-xl rounded-md border-2 border-surface-border bg-surface-kpi px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-teal"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!allTicked || !named || record.isPending} onClick={() => record.mutate('Approved')}>
              Approve ({ticked.size}/{rows.length} ticked)
            </Button>
            <Button variant="outline" disabled={!hasNote || !named || !storable || record.isPending} onClick={() => record.mutate('Returned')}>
              Return
            </Button>
            <Button variant="destructive" disabled={!hasNote || !named || !storable || record.isPending} onClick={() => record.mutate('Withdrawn')}>
              Withdraw
            </Button>
            {message && <span className={`text-sm font-semibold ${message.ok ? 'text-brand-leaf' : 'text-danger'}`}>{message.text}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
