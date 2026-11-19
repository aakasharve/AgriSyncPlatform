import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { PersonName } from '@/components/ui/PersonName';
import { LoadFailed, LoadingState, MeasuredZero } from '@/components/state';

// spec: plr-d10 lane SCH-A (Task 5; founder D-74, L8-R) - ShramSafal's check of a library schedule, day by day.
// A check is a ShramSafal PLATFORM act: the server records who checked (the signed-in person), when, and which version. This page
// only ever sends the decision, the ticked rows, the note and the name farmers read. Approve needs EVERY row ticked (R4): the
// checker ticks each activity with its days, repeat, part, role and "after" order (R34, D-104a). Return and Withdraw need a reason.
//
// CR-2d join (plan Task 3 Step 2, D3): routed as on the go-live line, with no menu entry (the templates page links here).
// Ported onto the September console's components and state rules only: no freshness chip (neither answer carries a server
// time, and a chip may only state an age it has), LoadingState / LoadFailed (always with Retry) / MeasuredZero for the
// states, the checker's name through PersonName, the token layer's classes. The words and the check itself are the lane's.

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-h1 font-bold text-text-1">
          <ClipboardCheck size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
          Schedule check
        </h1>
        <span className="text-caption text-text-3">no server timestamp</span>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-4">
        <Card>
          <CardHeader><CardTitle>Waiting for a check</CardTitle></CardHeader>
          <CardContent>
            {waiting.isLoading && <LoadingState label="Loading the schedules waiting for a check…" height={64} />}
            {waiting.isError && (
              <LoadFailed
                error={errorText(waiting.error)}
                onRetry={() => void waiting.refetch()}
                what="the schedules waiting for a check"
              />
            )}
            {!waiting.isLoading && !waiting.isError && !waiting.data?.length && (
              <MeasuredZero
                what="Nothing is waiting. A schedule waits here once its days are stored and nobody has decided on it."
                checkedAt="a time this answer does not report"
              />
            )}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {(waiting.data ?? []).map(w => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => setParams({ id: w.id })}
                    className={`w-full rounded-chip border px-3 py-2 text-left text-body transition-colors ${selectedId === w.id ? 'border-brand bg-brand-wash' : 'border-control-edge hover:border-brand hover:bg-wash'}`}
                  >
                    <span className="block font-semibold text-text-1">{w.name}</span>
                    <span className="block text-caption text-text-2">
                      v{w.version} - {w.stageCount} stages - {w.activityCount} activities{w.sourceLabel ? ` - ${w.sourceLabel}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div>
          {!selectedId && <div className="glass-panel rounded-panel py-16 text-center text-body text-text-2">Pick a schedule to check it day by day.</div>}
          {selectedId && schedule.isLoading && <LoadingState label="Loading the schedule…" height={160} />}
          {selectedId && schedule.isError && (
            <LoadFailed error={errorText(schedule.error)} onRetry={() => void schedule.refetch()} what="this schedule" />
          )}
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
        <span className="font-mono text-caption font-semibold text-text-2">{schedule.rowVersionTag ?? ''}</span>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-body text-text-2">
          <span>Crop: <b className="text-text-1">{schedule.cropType}</b></span>
          <span>Source: <b className="text-text-1">{schedule.sourceLabel ?? schedule.ownerType ?? '-'}</b></span>
          <span>Total days: <b className="text-text-1">{schedule.totalDays}</b></span>
          <span>
            Now: <b className="text-text-1">{schedule.check?.state ?? 'NotChecked'}</b>
            {schedule.check?.checkerDisplayName ? (
              <>
                {' - '}
                <PersonName name={schedule.check.checkerDisplayName} />
              </>
            ) : null}
          </span>
        </div>
        <p className="mb-3 text-caption text-text-2">
          Stages: {schedule.stages.map(s => `${s.name} (${s.startDay}-${s.endDay})`).join(' | ')}
        </p>

        {!storable && (
          <p className="mb-3 rounded-chip bg-tint-red p-3 text-body font-medium text-text-1">
            The days of this schedule are not stored, so it cannot be checked.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="text-left">
                {['Checked', 'Activity', 'Stage', 'Days', 'Repeat', 'Part', 'Operation', 'Role', 'After'].map(h => <th key={h} scope="col" className="whitespace-nowrap border-b border-line bg-panel-head px-3 py-2.5 text-caption font-bold text-text-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id ?? r.name} className="border-b border-line text-text-1">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Checked: ${r.name}`}
                      disabled={r.id === null}
                      checked={r.id !== null && ticked.has(r.id)}
                      onChange={() => r.id !== null && toggle(r.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-semibold text-text-1">{r.name}</td>
                  <td className="px-3 py-2">{r.stageName}</td>
                  <td className="px-3 py-2 font-mono text-caption">{r.startDay}-{r.endDay}</td>
                  <td className="px-3 py-2">{repeatText(r)}</td>
                  <td className="px-3 py-2">{r.part ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-caption">{r.operationKey ?? '-'}</td>
                  <td className="px-3 py-2">{r.role ? `${r.role}${r.nutrientKey ? ` (${r.nutrientKey})` : ''}` : '-'}</td>
                  <td className="px-3 py-2">{r.afterActivityId ? `after ${nameById.get(r.afterActivityId) ?? '?'}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-caption font-semibold text-text-1">
            Name farmers read
            <input
              type="text"
              value={checkerName}
              onChange={e => setCheckerName(e.target.value)}
              className="glass-quiet w-full max-w-md rounded-chip border border-control-edge px-3 py-2 text-body text-text-1 focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption font-semibold text-text-1">
            Reason (needed for Return and Withdraw)
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              className="glass-quiet w-full max-w-xl rounded-chip border border-control-edge px-3 py-2 text-body text-text-1 focus:border-brand"
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
            {message && <span role={message.ok ? 'status' : 'alert'} className={`text-body font-semibold ${message.ok ? 'text-green' : 'text-red'}`}>{message.text}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
