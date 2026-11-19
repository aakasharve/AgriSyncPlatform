/**
 * THE HONEST-STATE VOCABULARY — the words this console is allowed to use
 * when it has no number.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * Seven screens render a 500, a timeout and a 403 as good news today:
 * "No errors found. The system is healthy." `isError` appears in exactly
 * three files in the whole console (`App.tsx`, `FarmerSearchBox.tsx`,
 * `useAdminScope.ts`) — everywhere else a failure looks like a clean bill of
 * health (Preservation Register D9).
 *
 * The defect is not that those screens lack an error branch. It is that they
 * only have ONE word for absence. This module gives them four causes and
 * makes collapsing them back into one a visible act.
 *
 *   MeasuredZero — we looked, and the answer really is none.
 *   NoMatch      — your filter excluded everything. Not a zero.
 *   FeedDown     — the feed stopped. Names when, and never shows the last
 *                  good number as current.
 *   LoadFailed   — the request broke. Always retryable.
 *
 * ── The four state WORDS ──────────────────────────────────────────────────
 * These are a separate, narrower axis: the reason a single VALUE is absent.
 * Ported verbatim from the v3 prototype's `STATE_WORD` / `AS.none`
 * (`app.js:333-348` — the plan cites 341-350; `AS.none` itself is 341-348 and
 * `STATE_WORD` it depends on is 333-338. Both are carried).
 *
 * There are four and there is no fifth. Redaction is deliberately NOT one of
 * them: a redacted value is a permission fact, not a measurement fact, and
 * `Masked` renders it. Adding a fifth word here also silently widens
 * `KpiState`, which is the type the honesty override in `KpiCard` is built on.
 */

// `@/lib/adminErrors` is a pure module — no axios, no React — precisely so
// that this file can name a permission denial without dragging the transport
// into every chunk that only wanted the words. See the import-depth note in
// `./index.ts`.
import { describeAdminDenial } from '@/lib/adminErrors';

/** The four causes a single value can be absent for (CONTRACT.md §9.2). */
export type HonestState = 'unmeasured' | 'feed-down' | 'never' | 'unattributed';

/**
 * One word per cause. A screen-reader user hears the word; a sighted user
 * sees the em dash and the word beneath it. Neither ever gets a 0.
 *
 * Was declared locally in `KpiCard.tsx` at Task 3 with a comment saying
 * "Task 5 lifts this vocabulary into components/state as the single source
 * for tiles, table cells and whole panels; this file imports it from there
 * once it exists." This is that file, and KpiCard now imports it.
 */
export const STATE_WORD: Record<HonestState, string> = {
  unmeasured: 'not measured',
  'feed-down': 'feed down',
  never: 'never',
  unattributed: 'not attributable',
};

/** v3 `AS.stateWord` — an unrecognised state degrades to "not measured",
 *  never to a blank and never to a zero. */
export function stateWord(state: HonestState | null | undefined): string {
  return (state && STATE_WORD[state]) || STATE_WORD.unmeasured;
}

/**
 * The unwrapping ladder, lifted from
 * `features/farmer-health/components/EmptyAndErrorStates.tsx:95-104`:
 *
 *   denial → falsy → string → Error.message → object with a string `message`
 *   → fallback
 *
 * It lives here rather than inside one component because `ErrorState` and
 * `LoadFailed` both need it, and a second copy is how the two drift into
 * disagreeing about what an axios error says.
 *
 * ── The first rung is new in Task 11, and it is the only change ────────────
 * A PERMISSION DENIAL IS NOT A BROKEN REQUEST. The server distinguishes five
 * denial codes on purpose (AdminScopeHelper.cs:62,70,85,118,148), the axios
 * layer types two errors to carry that distinction — and nothing caught either
 * of them, so `error.message` was the raw code and a panel that hit
 * `admin_platform_only` printed exactly that string at a non-technical
 * operator. Naming the denial here reaches every panel in the console at once,
 * because every one of them renders its failure through `LoadFailed` or
 * `ErrorState`, and both render through this function.
 *
 * `describeAdminDenial` returns null for everything else, so a 500 stays a
 * 500. Telling someone their access is missing when the server is simply down
 * is the same lie pointing the other way.
 */
export function formatError(error: unknown): string {
  const denial = describeAdminDenial(error);
  if (denial) return denial.message;
  if (!error) return 'Unknown error.';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return 'Unexpected error — see console.';
}

/**
 * THE TWO SENTENCES, AS DATA — added in Task 22 and NOT a refactor for its own
 * sake.
 *
 * Task 22 puts the intervention queue on `DataList`, which owns the empty
 * branch and takes the words as `states.measuredZero.what` rather than as a
 * component. Without this export the port would have retyped both strings into
 * the screen, and the byte-for-byte assertions in
 * `__tests__/honestStates.test.tsx` would have gone on passing against a copy
 * nothing rendered. One source, read by `InterventionQueueEmpty` AND by the
 * screen.
 *
 * It lives HERE, in the vocabulary module, rather than beside the component,
 * for the reason this file's own header gives: this module holds words and no
 * JSX. Exporting a constant from a component file also trips
 * `react-refresh/only-export-components`, and a lint warning bought to save an
 * import is a bad trade.
 */
export const INTERVENTION_EMPTY = {
  understated: {
    message: 'No farms in intervention bucket yet.',
    /** Deliberately none. Saying "all scored farms are above the threshold"
     *  over an unscored cohort is a claim about farms nobody has measured. */
    hint: undefined as string | undefined,
  },
  normal: {
    message: 'No farms in intervention bucket.',
    hint: 'All scored farms are above the 40-pt intervention threshold.' as string | undefined,
  },
} as const;
