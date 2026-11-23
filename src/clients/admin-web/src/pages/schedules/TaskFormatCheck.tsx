import { useMemo, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7) - ShramSafal's check of a reference schedule written in the TASK FORMAT, task by task.
// The page shows EVERY field of every task and challenge, and every day as the farmer reads it: the server prints days through its one day helper
// (ScheduleDayNumbers: shown = stored + 1; a day before the start day is "N days before", never day 0 or a negative day). Approve needs EVERY task and
// challenge ticked, and is recorded against the content hash shown here; the person who made this version cannot approve it. There is deliberately no
// "tick all" button: a dose nobody looked at is never recorded as checked (doctrine P4).

export interface ShownDay {
  stored: number;
  shown: number | null;
  daysBeforeStart: number | null;
}

interface CheckStage {
  index: number;
  name: string;
  from: ShownDay;
  to: ShownDay;
  startSign: string | null;
  endSign: string | null;
}

interface TaskTiming {
  timer: 'none' | 'day' | 'after' | 'sign';
  fromDay: number | null;
  toDay: number | null;
  afterTaskKey: string | null;
  usualDays: number | null;
  earliestDays: number | null;
  latestDays: number | null;
  signWords: string | null;
  expectedFromDay: number | null;
  expectedToDay: number | null;
  whenWords: string | null;
  repeat: 'once' | 'every_n_days' | 'per_week';
  repeatInterval: number | null;
  repeatEndDay: number | null;
  repeatEndSign: string | null;
}

interface Product { name: string; doseAsWritten: string | null; unit: string | null; perWhat: string | null; water: string | null }
interface Source { document: string; page: string | null }
interface IfThen { if: string; then: string }

interface TaskContent {
  taskKey: string;
  name: string;
  kind: string;
  timing: TaskTiming;
  basis: string;
  stageIndex: number;
  order: number;
  why: string | null;
  dose: string | null;
  steps: string[];
  products: Product[];
  reEntryHours: number | null;
  preHarvestDays: number | null;
  warnings: string[];
  look: { where: string | null; sample: string | null; sign: string | null; threshold: string | null; ifThen: IfThen[]; photoRef: string | null } | null;
  ask: { question: string; when: string | null; answers: Array<{ answer: string; changes: string }> } | null;
  sources: Source[];
  origin: string | null;
}

interface ChallengeContent {
  challengeKey: string;
  title: string;
  stageIndex: number;
  order: number;
  whenWords: string | null;
  signs: string | null;
  action: string | null;
  ifThen: IfThen[];
  sources: Source[];
}

interface CheckTask {
  taskKey: string;
  contentHash: string;
  task: TaskContent;
  shown: { from: ShownDay | null; to: ShownDay | null; expectedFrom: ShownDay | null; expectedTo: ShownDay | null; repeatEnd: ShownDay | null };
  projectedForOldPhones: boolean;
}

interface CheckChallenge { challengeKey: string; contentHash: string; challenge: ChallengeContent }

export interface ScheduleCheckView {
  id: string;
  name: string;
  version: number;
  chainId: string | null;
  previousVersionId: string | null;
  cropKey: string | null;
  ownerType: string | null;
  sourceLabel: string | null;
  madeByUserId: string | null;
  madeByCaller: boolean;
  createdAtUtc: string;
  contentHash: string | null;
  check: { state: string; checkerDisplayName: string | null; checkedAtUtc: string | null; note: string | null };
  checkedTaskKeys: string[] | null;
  stages: CheckStage[];
  tasks: CheckTask[];
  challenges: CheckChallenge[];
  projectedActivityCount: number;
}

// PROPOSED (Marathi): what farmers read before the checker's own name.
const DEFAULT_CHECKER_NAME = 'श्रमसफल कृषी तज्ज्ञ ';

/** A day as the farmer reads it (the server's one day helper decided the number). */
function dayText(d: ShownDay | null | undefined): string {
  if (!d) return '-';
  if (d.daysBeforeStart !== null) return `${d.daysBeforeStart} days before start`;
  return `day ${d.shown}`;
}

function windowText(from: ShownDay | null, to: ShownDay | null): string {
  if (!from) return '-';
  if (!to) return `from ${dayText(from)} (no end stated)`;
  if (to.stored === from.stored) return dayText(from);
  return `${dayText(from)} to ${dayText(to)}`;
}

function whenText(t: CheckTask): string {
  const timing = t.task.timing;
  switch (timing.timer) {
    case 'day':
      return windowText(t.shown.from, t.shown.to);
    case 'after': {
      const parts = [`usual ${timing.usualDays ?? '-'}`, `earliest ${timing.earliestDays ?? '-'}`, `latest ${timing.latestDays ?? '-'}`];
      return `after "${timing.afterTaskKey}" is recorded: ${parts.join(', ')} days`;
    }
    case 'sign':
      return `when seen: ${timing.signWords}${t.shown.expectedFrom ? ` (expected ${windowText(t.shown.expectedFrom, t.shown.expectedTo)})` : ''}`;
    default:
      return 'no day (never given one)';
  }
}

function repeatText(t: CheckTask): string {
  const timing = t.task.timing;
  if (timing.repeat === 'once') return 'once';
  const every = timing.repeat === 'per_week' ? `${timing.repeatInterval} per week` : `every ${timing.repeatInterval} days`;
  const end = timing.repeatEndDay !== null ? `, until ${dayText(t.shown.repeatEnd)}` : timing.repeatEndSign ? `, until "${timing.repeatEndSign}"` : '';
  return every + end;
}

function errorText(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string; error?: string } } } | null)?.response;
  if (response?.status === 403) return 'You do not hold the schedule review seat.';
  return response?.data?.message ?? response?.data?.error ?? 'The check was not recorded.';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-0.5 text-[13px]">
      <span className="font-semibold text-text-muted">{label}</span>
      <span className="text-text-primary">{children}</span>
    </div>
  );
}

const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '-' : v);

function Lines({ items }: { items: string[] }) {
  if (!items.length) return <>-</>;
  return <ol className="m-0 list-decimal pl-5">{items.map((s, i) => <li key={i}>{s}</li>)}</ol>;
}

function IfThens({ items }: { items: IfThen[] }) {
  if (!items.length) return <>-</>;
  return <ul className="m-0 list-disc pl-5">{items.map((p, i) => <li key={i}>if {p.if} then {p.then}</li>)}</ul>;
}

function Sources({ items }: { items: Source[] }) {
  if (!items.length) return <>-</>;
  return <ul className="m-0 list-disc pl-5">{items.map((s, i) => <li key={i}>{s.document}{s.page ? `, page ${s.page}` : ''}</li>)}</ul>;
}

function TaskCard({ t, stageName, ticked, onToggle }: { t: CheckTask; stageName: string; ticked: boolean; onToggle: () => void }) {
  const c = t.task;
  return (
    <li data-testid={`task-${t.taskKey}`} className={`rounded-lg border-2 p-3 ${ticked ? 'border-brand-leaf bg-surface-panel' : 'border-surface-border bg-surface-glass'}`}>
      <label className="mb-2 flex items-center gap-3">
        <input type="checkbox" aria-label={`Checked: ${c.name}`} checked={ticked} onChange={onToggle} className="h-5 w-5" />
        <span className="text-[15px] font-bold text-text-primary">{c.name}</span>
        <span className="font-mono text-[11px] text-text-muted">{t.taskKey}</span>
        <span className={`ml-auto rounded px-2 py-0.5 text-[11px] font-bold ${t.projectedForOldPhones ? 'bg-brand-teal/15 text-brand-teal' : 'bg-surface-sidebar text-text-muted'}`}>
          {t.projectedForOldPhones ? 'also on old phones' : 'new format only'}
        </span>
      </label>
      <Field label="Kind / basis">{c.kind} / {c.basis}</Field>
      <Field label="Stage / order">{stageName} / {c.order}</Field>
      <Field label="When">{whenText(t)}</Field>
      <Field label="When (source words)">{dash(c.timing.whenWords)}</Field>
      <Field label="Repeat">{repeatText(t)}</Field>
      <Field label="Why">{dash(c.why)}</Field>
      <Field label="Dose (as written)">{dash(c.dose)}</Field>
      <Field label="Steps"><Lines items={c.steps} /></Field>
      <Field label="Products">
        {c.products.length === 0 ? '-' : (
          <ul className="m-0 list-disc pl-5">
            {c.products.map((p, i) => (
              <li key={i}>{p.name}{p.doseAsWritten ? `: ${p.doseAsWritten}` : ''}{p.unit ? ` (unit ${p.unit})` : ''}{p.perWhat ? ` per ${p.perWhat}` : ''}{p.water ? `, water ${p.water}` : ''}</li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Re-entry gap">{c.reEntryHours === null ? '-' : `${c.reEntryHours} hours`}</Field>
      <Field label="Pre-harvest gap">{c.preHarvestDays === null ? '-' : `${c.preHarvestDays} days`}</Field>
      <Field label="Warnings"><Lines items={c.warnings} /></Field>
      <Field label="Look: where">{dash(c.look?.where)}</Field>
      <Field label="Look: sample">{dash(c.look?.sample)}</Field>
      <Field label="Look: sign">{dash(c.look?.sign)}</Field>
      <Field label="Look: threshold">{dash(c.look?.threshold)}</Field>
      <Field label="If - then"><IfThens items={c.look?.ifThen ?? []} /></Field>
      <Field label="Photo reference">{dash(c.look?.photoRef)}</Field>
      <Field label="Ask">
        {c.ask ? (
          <span>{c.ask.question}{c.ask.when ? ` (${c.ask.when})` : ''}{c.ask.answers.map(a => ` | ${a.answer}: ${a.changes}`).join('')}</span>
        ) : '-'}
      </Field>
      <Field label="Sources"><Sources items={c.sources} /></Field>
      <Field label="Origin">{dash(c.origin)}</Field>
      <Field label="Content hash"><span className="font-mono text-[11px]">{t.contentHash.slice(0, 16)}</span></Field>
    </li>
  );
}

function ChallengeCard({ c, stageName, ticked, onToggle }: { c: CheckChallenge; stageName: string; ticked: boolean; onToggle: () => void }) {
  const x = c.challenge;
  return (
    <li data-testid={`challenge-${c.challengeKey}`} className={`rounded-lg border-2 p-3 ${ticked ? 'border-brand-leaf bg-surface-panel' : 'border-surface-border bg-surface-glass'}`}>
      <label className="mb-2 flex items-center gap-3">
        <input type="checkbox" aria-label={`Checked: ${x.title}`} checked={ticked} onChange={onToggle} className="h-5 w-5" />
        <span className="text-[15px] font-bold text-text-primary">{x.title}</span>
        <span className="font-mono text-[11px] text-text-muted">{c.challengeKey}</span>
      </label>
      <Field label="Stage / order">{stageName} / {x.order}</Field>
      <Field label="When (words)">{dash(x.whenWords)}</Field>
      <Field label="Signs">{dash(x.signs)}</Field>
      <Field label="Action">{dash(x.action)}</Field>
      <Field label="If - then"><IfThens items={x.ifThen} /></Field>
      <Field label="Sources"><Sources items={x.sources} /></Field>
    </li>
  );
}

export function TaskFormatCheck({ view, onDone }: { view: ScheduleCheckView; onDone: () => void }) {
  const stageNames = useMemo(() => new Map(view.stages.map(s => [s.index, s.name] as const)), [view.stages]);
  const [tickedTasks, setTickedTasks] = useState<Set<string>>(new Set());
  const [tickedChallenges, setTickedChallenges] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [checkerName, setCheckerName] = useState(DEFAULT_CHECKER_NAME);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const total = view.tasks.length + view.challenges.length;
  const ticked = tickedTasks.size + tickedChallenges.size;
  const allTicked = view.tasks.every(t => tickedTasks.has(t.taskKey)) && view.challenges.every(c => tickedChallenges.has(c.challengeKey));
  const named = checkerName.trim().length > 0;
  const hasNote = note.trim().length > 0;

  const record = useMutation({
    mutationFn: async (decision: 'Approved' | 'Returned' | 'Withdrawn') => {
      const { data } = await adminApi.post(`/shramsafal/schedule-templates/${view.id}/check`, {
        decision,
        checkedActivityIds: [],
        checkedTaskKeys: decision === 'Approved' ? [...tickedTasks] : null,
        checkedChallengeKeys: decision === 'Approved' ? [...tickedChallenges] : null,
        contentHash: view.contentHash,
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

  // Functional update: two ticks in one render never overwrite each other (a stale set would drop the first).
  function toggle(setter: (update: (prev: Set<string>) => Set<string>) => void, key: string) {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{view.name}</CardTitle>
        <span className="font-mono text-[12px] font-bold text-text-muted">v{view.version}</span>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-muted">
          <span>Crop: <b className="text-text-primary">{view.cropKey ?? '-'}</b></span>
          <span>Source: <b className="text-text-primary">{view.sourceLabel ?? '-'}</b></span>
          <span>From: <b className="text-text-primary">{view.ownerType ?? '-'}</b></span>
          <span>Chain: <b className="font-mono text-text-primary">{view.chainId?.slice(0, 8) ?? '-'}</b></span>
          <span>Made by: <b className="text-text-primary">{view.madeByCaller ? 'you' : 'another person'}</b></span>
          <span>Now: <b className="text-text-primary">{view.check.state}</b>{view.check.checkerDisplayName ? ` - ${view.check.checkerDisplayName}` : ''}</span>
          <span>Tasks: <b className="text-text-primary">{view.tasks.length}</b>, challenges: <b className="text-text-primary">{view.challenges.length}</b>, on old phones: <b className="text-text-primary">{view.projectedActivityCount}</b></span>
          <span>Content hash: <b className="font-mono text-text-primary">{view.contentHash?.slice(0, 16)}</b></span>
        </div>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
              {['Stage', 'Days (as the farmer reads them)', 'Starts on', 'Ends on'].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.stages.map(s => (
              <tr key={s.index} className="border-b border-row-divider">
                <td className="py-1.5 pr-3 font-semibold text-text-primary">{s.name}</td>
                <td className="py-1.5 pr-3">{dayText(s.from)} to {dayText(s.to)}</td>
                <td className="py-1.5 pr-3">{s.startSign ?? '-'}</td>
                <td className="py-1.5 pr-3">{s.endSign ? `${s.endSign} (day is expected)` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {view.stages.map(s => {
          const tasks = view.tasks.filter(t => t.task.stageIndex === s.index);
          const challenges = view.challenges.filter(c => c.challenge.stageIndex === s.index);
          return (
            <section key={s.index} className="mb-5">
              <h3 className="mb-2 text-[15px] font-extrabold text-text-primary">{s.name} <span className="text-[12px] font-semibold text-text-muted">({dayText(s.from)} to {dayText(s.to)})</span></h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {tasks.map(t => (
                  <TaskCard key={t.taskKey} t={t} stageName={stageNames.get(t.task.stageIndex) ?? '-'} ticked={tickedTasks.has(t.taskKey)}
                    onToggle={() => toggle(setTickedTasks, t.taskKey)} />
                ))}
              </ul>
              {challenges.length > 0 && (
                <>
                  <h4 className="mb-2 mt-3 text-[13px] font-extrabold uppercase tracking-[0.06em] text-text-muted">Challenges of this stage</h4>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {challenges.map(c => (
                      <ChallengeCard key={c.challengeKey} c={c} stageName={stageNames.get(c.challenge.stageIndex) ?? '-'} ticked={tickedChallenges.has(c.challengeKey)}
                        onToggle={() => toggle(setTickedChallenges, c.challengeKey)} />
                    ))}
                  </ul>
                </>
              )}
            </section>
          );
        })}

        <div className="sticky bottom-0 mt-4 flex flex-col gap-3 rounded-lg border-2 border-surface-border bg-surface-kpi p-3">
          {view.madeByCaller && (
            <p className="m-0 text-sm font-semibold text-danger">You made this version, so you cannot approve it. Another checker approves it.</p>
          )}
          <label className="flex flex-col gap-1 text-sm font-semibold text-text-primary">
            Name farmers read
            <input type="text" value={checkerName} onChange={e => setCheckerName(e.target.value)}
              className="w-full max-w-md rounded-md border-2 border-surface-border bg-surface-kpi px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-teal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-text-primary">
            Reason (needed for Return and Withdraw)
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
              className="w-full max-w-xl rounded-md border-2 border-surface-border bg-surface-kpi px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-teal" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!allTicked || !named || view.madeByCaller || record.isPending} onClick={() => record.mutate('Approved')}>
              Approve ({ticked}/{total} ticked)
            </Button>
            <Button variant="outline" disabled={!hasNote || !named || record.isPending} onClick={() => record.mutate('Returned')}>Return</Button>
            <Button variant="destructive" disabled={!hasNote || !named || record.isPending} onClick={() => record.mutate('Withdrawn')}>Withdraw</Button>
            {message && <span className={`text-sm font-semibold ${message.ok ? 'text-brand-leaf' : 'text-danger'}`}>{message.text}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
