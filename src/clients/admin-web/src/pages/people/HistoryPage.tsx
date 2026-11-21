import { Link, useSearchParams } from 'react-router-dom';
import { LoadFailed, LoadingState } from '@/components/state';
import { useHistory } from '@/hooks/useControlRoomPeople';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { fmtIndiaDateTime } from '@/lib/indiaTime';
import { HISTORY_ACTIONS, historyText } from './historyText';

const DAY_CHOICES = [7, 30, 90] as const;

/** A `days` value from the address, kept inside what the server accepts (7 to 90). */
function readDays(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 7) return 7;
  return Math.min(90, Math.round(n));
}

/** An ISO instant from the address, or null when it is not a date. */
function readInstant(raw: string | null): string | null {
  if (!raw) return null;
  return Number.isFinite(Date.parse(raw)) ? raw : null;
}

/**
 * HISTORY (CR-3, D-155): what happened to who has access, newest first, one sentence a line.
 * The server writes it and nothing here can change it. The window and the kind of line are in the
 * address (`?days=7&action=phones_shown`), so the trust report's numbers can open the exact lines
 * they were counted from.
 */
export default function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const days = readDays(params.get('days'));
  const action = params.get('action') || null;
  /* W-3: the trust report opens the exact window it counted: `fromUtc` and `toUtc` together (a lone
     one is ignored, and `days` applies), and `countedLooksOnly` for just the lines it counted. */
  const fromUtc = readInstant(params.get('fromUtc'));
  const toUtc = readInstant(params.get('toUtc'));
  const exact = fromUtc && toUtc
    ? { fromUtc, toUtc, countedLooksOnly: params.get('countedLooksOnly') === 'true' }
    : null;
  const q = useHistory(days, action, exact);

  function set(next: { days?: number; action?: string | null }) {
    const merged = new URLSearchParams(params);
    if (next.days !== undefined) {
      merged.set('days', String(next.days));
      /* Choosing a period leaves the trust report's exact window. */
      merged.delete('fromUtc');
      merged.delete('toUtc');
      merged.delete('countedLooksOnly');
    }
    if (next.action !== undefined) {
      if (next.action) merged.set('action', next.action);
      else merged.delete('action');
    }
    setParams(merged, { replace: true });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to="/people" className="text-caption font-semibold text-text-2 underline underline-offset-4">
          Back to People and access
        </Link>
        <h1 className="mt-1 text-h1 font-bold text-text-1">History</h1>
        <p className="max-w-[var(--text-measure)] text-body text-text-2">
          Who was given, changed or lost access, who signed in, and who looked at farmers' phone numbers.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-1">Period</span>
          <select
            value={days}
            onChange={(e) => set({ days: Number(e.target.value) })}
            className="glass-quiet rounded-chip border-control-edge px-3 py-2 text-body text-text-1"
          >
            {DAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
            {!DAY_CHOICES.includes(days as (typeof DAY_CHOICES)[number]) && (
              <option value={days}>Last {days} days</option>
            )}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-1">Kind of line</span>
          <select
            value={action ?? ''}
            onChange={(e) => set({ action: e.target.value || null })}
            className="glass-quiet rounded-chip border-control-edge px-3 py-2 text-body text-text-1"
          >
            <option value="">Everything</option>
            {HISTORY_ACTIONS.map((a) => (
              <option key={a.action} value={a.action}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {exact && (
        <p data-testid="history-exact-window" className="text-caption text-text-2">
          Showing exactly the {exact.countedLooksOnly ? 'lines the trust report counted' : 'lines'}, from{' '}
          {fmtIndiaDateTime(exact.fromUtc) ?? 'an unknown time'} to {fmtIndiaDateTime(exact.toUtc) ?? 'an unknown time'}.
        </p>
      )}

      {q.isLoading && <LoadingState label="Loading History" height={160} />}
      {(q.isError || (!q.isLoading && !q.data)) && (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} what="History" />
      )}

      {q.data && (
        <>
          {q.data.hitLimit && (
            <p role="status" className="rounded-chip bg-tint-amber px-4 py-2 text-body text-text-1">
              Showing the newest {fmt.num(q.data.limit) ?? q.data.limit}. Older lines in this period are not shown.
            </p>
          )}
          {q.data.lines.length === 0 ? (
            <p className="text-body text-text-2">Nothing was written in this period.</p>
          ) : (
            <ol className="glass-panel divide-y divide-border rounded-panel">
              {q.data.lines.map((line, i) => (
                <li key={`${line.atUtc}|${line.action}|${i}`} className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:gap-5">
                  <time dateTime={line.atUtc} className="w-36 flex-none text-caption text-text-2">
                    {fmt.dateTime(line.atUtc, DATE_FORMATS.usersLastLogin) ?? line.atUtc}
                  </time>
                  <span className="text-body text-text-1">{historyText(line)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <p className="text-caption text-text-2">History cannot be edited or deleted, by anyone.</p>
    </div>
  );
}
