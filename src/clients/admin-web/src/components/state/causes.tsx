import type { ReactNode } from 'react';
import { CircleCheck, Info, SearchX, TriangleAlert, Unplug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { formatError } from './honestState';

/**
 * FOUR CAUSES, NOT ONE.
 *
 * Today seven screens render a 500, a timeout or a 403 as good news — "No
 * errors found. The system is healthy.", "No farms with repeated errors —
 * great!", "No users found". `isError` is referenced in exactly three files
 * repo-wide. This file is what makes that impossible to repeat
 * (Preservation Register D9; CONTRACT.md §6.1-6.4, §9).
 *
 * The four are kept in ONE file on purpose. Side by side, choosing the wrong
 * one is obvious; in four folders, "empty" quietly becomes the default again.
 *
 *   NoMatch      §6.1 — your filter excluded everything.
 *   MeasuredZero §6.2 — we looked, over a named window, and it really is none.
 *   FeedDown     §6.3 — the feed stopped, at a named time, and nothing below
 *                       the line is current.
 *   LoadFailed        — the request broke. v3 has no fetch and therefore no
 *                       equivalent; this one is the port's own, and it is the
 *                       cause the seven screens are actually mislabelling.
 *
 * Plus §6.4 `NotMeasuredPanel` — a whole panel with no data source at all,
 * which is a fifth thing again and not a broken one.
 */

interface StateBlockProps {
  /** `measured-zero` | `no-match` | `feed-down` | `load-failed` | `unmeasured`.
   *  Lands on the DOM so tests assert the contract, not a class string. */
  state: string;
  icon: ReactNode;
  title: ReactNode;
  /**
   * v3 `.as-state` (centred, quiet, no tint) for a fact about the DATA;
   * v3 `.as-broken` / `.as-note` (a tinted row, icon beside the text) for a
   * fact about the PIPE. The two read differently on purpose: one is where
   * a table would have been, the other interrupts the page.
   */
  layout: 'centred' | 'banner';
  /** Red for a break, plain for a fact. §9.4 — an honesty state outranks any
   *  semantic colour, so a MEASURED zero is never green and never a tick of
   *  celebration; the tone here is only ever "broken" or "not broken". */
  broken?: boolean;
  children: ReactNode;
  action?: ReactNode;
  /** `alert` for the two that mean something is wrong; `status` +
   *  `aria-live="polite"` for the facts, so a poll does not shout. */
  role: 'status' | 'alert';
  className?: string;
}

/**
 * The shared shell. On the token layer — no raw hex anywhere in this file.
 *
 * ── RESTYLED 2026-09-02, WITHOUT MOVING ONE RULE ─────────────────────────
 * The founder's note was that "not measured" looked like a missing feature
 * rather than a deliberate answer, and he was right: a 34px outline glyph in
 * the honesty grey, a line of 16px text and nothing else reads as a screen
 * someone did not finish. So the COMPOSITION changed — the icon sits in a
 * proper badge, the title takes the shared type scale, the body gets a
 * measured line length and the banner gets a leading edge — and the COLOUR
 * LOGIC did not:
 *
 *   broken   → tint-red, red-vivid edge, a red icon.  A failure.
 *   not      → tint-grey, edge-grey edge, a grey icon. §9.4: an honesty state
 *              outranks any semantic colour, so a MEASURED zero is still
 *              never green and still never a tick of celebration.
 *
 * ONE COLOUR MOVED, and it moved to be MORE legible rather than louder: the
 * banner's title was `text-red` on `tint-red`, which measures 4.13:1 and is
 * short of AA for a sentence someone has to read while something is broken.
 * It is the ink colour now (14.76:1) and the RED IS ON THE ICON, where a hue
 * carries at 3:1. Nothing about what red means changed — a failure still
 * announces itself in the failure colour.
 */
function StateBlock({
  state,
  icon,
  title,
  layout,
  broken,
  children,
  action,
  role,
  className,
}: StateBlockProps) {
  const banner = layout === 'banner';
  return (
    <div
      data-state={state}
      role={role}
      {...(role === 'status' ? { 'aria-live': 'polite' as const } : {})}
      className={cn(
        banner
          ? 'relative flex items-start gap-3 overflow-hidden rounded-panel py-4 pr-5 pl-6 text-left'
          : 'flex flex-col items-center gap-2 px-5 py-14 text-center',
        banner && (broken ? 'bg-tint-red' : 'bg-tint-grey'),
        className
      )}
    >
      {banner && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-0 w-1.5',
            broken ? 'bg-red-vivid' : 'bg-edge-grey'
          )}
        />
      )}
      <span
        aria-hidden="true"
        className={cn(
          'grid flex-none place-items-center',
          banner ? 'mt-0.5' : 'mb-2 size-14 rounded-panel',
          banner ? '' : broken ? 'bg-tint-red' : 'bg-tint-grey',
          broken ? 'text-red' : 'text-text-3'
        )}
      >
        {icon}
      </span>
      <div className={banner ? 'flex-1' : 'contents'}>
        <p
          className={cn(
            'text-text-1',
            banner ? 'text-h3 font-semibold' : 'text-h2 font-bold'
          )}
        >
          {title}
        </p>
        <div className={cn('text-body text-text-2', banner ? 'mt-1' : 'max-w-[58ch]')}>
          {children}
        </div>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── §6.1 NoMatch */

export interface NoMatchProps {
  /** The filter as a human would say it — `“भोसले”`, `tier = Pro`,
   *  `endpoint contains /voice`. Not a serialised query string. */
  filterInWords: string;
  onClear: () => void;
  /** What the filter actually searches, when that is not obvious.
   *  v3 §6.1: "Search runs over farm name, owner and phone." */
  searchesOver?: string;
  className?: string;
}

/**
 * Your filter excluded everything. NOT a measured zero.
 *
 * The distinction is the whole point: a measured zero is a fact about the
 * farm; a no-match is a fact about the box you typed in. Collapsing them
 * tells an operator the system is quiet when it is only being filtered.
 */
export function NoMatch({ filterInWords, onClear, searchesOver, className }: NoMatchProps) {
  return (
    <StateBlock
      state="no-match"
      layout="centred"
      role="status"
      icon={<SearchX size={34} strokeWidth={1.5} />}
      title={<>Nothing matches {filterInWords}</>}
      className={className}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          Clear filter
        </Button>
      }
    >
      Your filter excluded every row. That is not a measured zero — clear it to see what is there.
      {searchesOver && <span className="mt-1 block">{searchesOver}</span>}
    </StateBlock>
  );
}

/* ───────────────────────────────────────────────────── §6.2 MeasuredZero */

export interface MeasuredZeroProps {
  /** What was checked, in words, WITH its window:
   *  "No errors in the last 2 hours". */
  what: string;
  /** When the window was checked. Pass a formatted time from `@/lib/format`
   *  — never a raw ISO string, and never `new Date()` computed at render,
   *  which is the fabricated-freshness defect (D5). */
  checkedAt: string;
  className?: string;
}

/**
 * We looked, and the answer really is none.
 *
 * It says so IN WORDS and it names when it checked, because "nothing here"
 * with no window behind it is indistinguishable from a feed that died.
 */
export function MeasuredZero({ what, checkedAt, className }: MeasuredZeroProps) {
  return (
    <StateBlock
      state="measured-zero"
      layout="centred"
      role="status"
      icon={<CircleCheck size={34} strokeWidth={1.5} />}
      title={what}
      className={className}
    >
      The window was checked at {checkedAt}. This is a measured zero, not a missing feed.
    </StateBlock>
  );
}

/* ───────────────────────────────────────────────────────── §6.3 FeedDown */

export interface FeedDownProps {
  /** When it stopped, already formatted — "06:12 today". MANDATORY. A
   *  feed-down block with no time is just an outage rumour. */
  since: string;
  /**
   * The last figure the feed produced, WITH its own timestamp:
   * "41 logs at 06:11".
   *
   * 🛑 It is rendered ONLY inside the sentence that disowns it. Never lift
   * this into a heading, a KPI value or a table cell. A stale number
   * presented as today's is the most damaging thing this console can do to a
   * decision, and it is the exact thing CONTRACT.md §6.3 and §9.3 forbid.
   */
  lastGood?: string;
  /** What stopped. Defaults to "The feed". */
  what?: string;
  /** What the last figure is NOT. Defaults to the standard "today's count". */
  historyLabel?: string;
  className?: string;
}

/**
 * The feed stopped.
 *
 * Two non-negotiables, both asserted in `__tests__/honestStates.test.tsx`:
 *   1. it names the time it stopped;
 *   2. it never presents the last good number as current.
 */
export function FeedDown({
  since,
  lastGood,
  what = 'The feed',
  historyLabel = "today's count",
  className,
}: FeedDownProps) {
  return (
    <StateBlock
      state="feed-down"
      layout="banner"
      role="alert"
      broken
      icon={<Unplug size={20} strokeWidth={1.8} />}
      title={<>Feed down since {since}</>}
      className={className}
    >
      {what} stopped at {since} and has not emitted since. Nothing below this line is current.
      {lastGood && (
        <span data-lastgood="" className="mt-1 block">
          The last figure it produced was {lastGood} &mdash; that is history, not {historyLabel}.
        </span>
      )}
    </StateBlock>
  );
}

/* ────────────────────────────────────────────────────────── LoadFailed */

export interface LoadFailedProps {
  error: unknown;
  /** Always retryable — REQUIRED, unlike `ErrorState.onRetry`. A failure a
   *  reader cannot act on is a failure they learn to scroll past. */
  onRetry: () => void;
  /** What failed to load. Defaults to "this panel". */
  what?: string;
  className?: string;
}

/**
 * The request broke.
 *
 * This is the cause the seven silent-failure screens are actually hitting
 * when they say "No errors found. The system is healthy." A 500 is not a
 * measured zero and it is not an empty table.
 */
export function LoadFailed({ error, onRetry, what = 'this panel', className }: LoadFailedProps) {
  return (
    <StateBlock
      state="load-failed"
      layout="banner"
      role="alert"
      broken
      icon={<TriangleAlert size={20} strokeWidth={1.8} />}
      title={<>Couldn&apos;t load {what}.</>}
      className={className}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <span className="break-words">{formatError(error)}</span>
      <span className="mt-1 block">
        Nothing is shown below because nothing was received &mdash; this is not an empty result.
      </span>
    </StateBlock>
  );
}

/* ──────────────────────────────────────────────── §6.4 NotMeasuredPanel */

export interface NotMeasuredPanelProps {
  /** Why there is no source. Required — a panel that says "not measured" and
   *  stops has told the reader nothing they did not already see. */
  why: ReactNode;
  /** Overrides the "Not measured" heading where a better one exists. */
  title?: ReactNode;
  className?: string;
}

/**
 * A whole panel with no data source AT ALL — not a broken one.
 *
 * v3 §6.4's example is the honest version of a real gap: "The DB-backed admin
 * table ssf.admin_users has never been read — its migration has not been run.
 * This console is showing one source of two."
 */
export function NotMeasuredPanel({ why, title = 'Not measured', className }: NotMeasuredPanelProps) {
  return (
    <StateBlock
      state="unmeasured"
      layout="banner"
      role="status"
      icon={<Info size={20} strokeWidth={1.8} />}
      title={title}
      className={className}
    >
      {why}
    </StateBlock>
  );
}
