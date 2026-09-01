import { format as formatDate, isValid, parseISO } from 'date-fns';

/**
 * THE formatter module. There is exactly one, and this is it.
 *
 * ── The rule this file exists to enforce ──────────────────────────────────
 * Every formatter returns `null` for a missing input. Not '0', not '—', not
 * ''. `null`.
 *
 * That is not a coding convention. It is the mechanism that stops a missing
 * measurement falling through and landing on screen as a ZERO. A zero and
 * "we have no reading" are different facts, and printing the first when you
 * mean the second is the exact defect this redesign exists to remove
 * (Preservation Register D5 and D18; CONTRACT.md §9).
 *
 * A `null` coming out of here is rendered by the caller through the honest
 * non-value component — never as text, never with `?? 0`, never with `|| 0`.
 * If you find yourself writing `fmt.num(x) ?? '0'`, stop: that is the bug.
 *
 * Ported from the v3 prototype's `AS.fmt` (app.js lines 164-215), whose
 * `empty()` / `group()` pair is the same rule expressed in plain JS.
 *
 * NOTE ON SCOPE: this task CREATES the module. It does not re-point the
 * fourteen files that import date-fns directly today — those move screen by
 * screen in Tasks 14-26, so a mechanical change can never hide a behavioural
 * one. Until then the constants below DOCUMENT those call sites; they do not
 * yet drive them.
 */

/** A value that is absent, or a number that cannot be printed as one. */
function empty(v: number | null | undefined): boolean {
  return v === null || v === undefined || !Number.isFinite(v);
}

/**
 * Indian digit grouping (2,47,70,000 — not 2,477,000) with FIXED decimal
 * places, so a column of 4.2 / 12.75 / 3 prints 4.20 / 12.75 / 3.00 and the
 * decimal points line up under tabular-nums. Alignment is not a CSS problem;
 * it is a consistent-places problem. (v3 app.js `group`.)
 */
function group(v: number, places: number): string {
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** Accepts what an API actually hands us for a timestamp. */
export type DateInput = string | number | Date | null | undefined;

/** Parses without ever throwing. date-fns `format` throws a RangeError on an
 *  invalid date, which is why four components already wrap it in try/catch.
 *  That defensive duplication ends here. */
function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d =
    value instanceof Date ? value : typeof value === 'number' ? new Date(value) : parseISO(value);
  return isValid(d) ? d : null;
}

/**
 * The per-surface date choices. THESE DIFFER ON PURPOSE.
 *
 * API Errors shows the full date because an operator reading it may be looking
 * days back; Ops Live shows time only because its whole window is the last two
 * hours. Silent Churn shows a four-digit year because "never" and "March 2024"
 * are the readings that matter there.
 *
 * Anyone "tidying" these into one shared format would break both screens'
 * usefulness at once, which is why they are recorded here with their reasons
 * instead of being left as eleven loose literals in eleven files
 * (Preservation Register A51).
 *
 * Line numbers verified against the tree at 4ba5865f. Every format string was
 * read from the file, not copied from the plan — three of the plan's line
 * citations were off by one and the code won.
 */
export const DATE_FORMATS = {
  /** Full date + seconds — an operator may be looking days back. OpsErrorsPage.tsx:21 */
  opsErrorsRow: 'yyyy-MM-dd HH:mm:ss',
  /** Time only — the whole window is the last two hours. OpsLivePage.tsx:108 */
  opsLiveRow: 'HH:mm:ss',
  /** Time only, no seconds — a summary column, not a log line. OpsLivePage.tsx:166 */
  opsLiveLastErr: 'HH:mm',
  /** Day + month — "did this farm log recently". FarmsListPage.tsx:90 */
  farmsLastLog: 'dd MMM',
  /** Two-digit year — farms predate this year. FarmsListPage.tsx:91 */
  farmsCreated: 'dd MMM yy',
  /** Two-digit year, matching Farms. UsersPage.tsx:66 */
  usersCreated: 'dd MMM yy',
  /** Date AND time — "when did this person last actually sign in". UsersPage.tsx:67 */
  usersLastLogin: 'dd MMM yy, HH:mm',
  /** Four-digit year — a silent farm may have gone quiet years ago. SilentChurnPage.tsx:41 */
  churnLastLog: 'dd MMM yyyy',
  /** Time FIRST, then the date — the hour is the signal on a suffering row. SufferingPage.tsx:42 */
  sufferLastErr: 'HH:mm, dd MMM',
  /** Date then time, no year — the cohort queue is a recent window. InterventionQueueTable.tsx:37 */
  cohortRow: 'dd MMM, HH:mm',
  /** Four-digit year — a worker's start date is a record, not a recency. WorkerSummaryList.tsx:29 */
  workerSince: 'dd MMM yyyy',
  /**
   * Day + month, no year — one slot on the voice window's axis, which is
   * never wider than 31 dates. OpsVoicePage.tsx:115 (the recharts
   * `tickFormatter`), moved here by Task 19.
   *
   * The Task 4 report listed eleven `format(...)` call sites this table did
   * not cover, all of them recharts axis and tooltip formats, and routed them
   * to Tasks 19, 21 and 22. This is the first of them to arrive.
   */
  voiceDay: 'd MMM',
  /**
   * One slot on the WVFD axis — a week START, which is always a Monday.
   * `NorthStarPage.tsx:174` (the recharts `tickFormatter`), moved here by
   * Task 21.
   *
   * ⚠️ THE PATTERN CHANGED, and it is recorded rather than slipped in. That
   * call site read `'MMM d'` — "Aug 10" — the ONLY month-first date format in
   * a console whose other twelve are all day-first. Two axes now sit two
   * screens apart (`voiceDay` here is `'d MMM'`), and an operator comparing
   * them would be reading two orders of the same three characters. Day-first
   * wins because twelve call sites already are, and because v3 renders this
   * exact label with `Number(p[2]) + ' ' + MONTHS[...]` — "10 Aug"
   * (`wvfd.html:211-214`).
   */
  nsmWeek: 'd MMM',
  /**
   * A week named in PROSE — "the week of 10 August 2026". Four-digit year,
   * because a 52-week window reaches back across a year boundary and "10 Aug"
   * alone would be ambiguous there. Preserved exactly from the tooltip's
   * `labelFormatter` at `NorthStarPage.tsx:201`.
   */
  nsmWeekFull: 'dd MMM yyyy',
} as const;

export const fmt = {
  /**
   * 1402 -> "1,402"; 2477000 -> "24,77,000".
   * `decimals` fixes the places for column alignment.
   */
  num(v: number | null | undefined, decimals = 0): string | null {
    return empty(v) ? null : group(v as number, decimals);
  },

  /**
   * A PERCENTAGE, already on the 0-100 scale: 94.2 -> "94.2%". The `%` stays
   * tight against the figure — it is part of the number, not a unit beside it.
   *
   * If what you hold is a RATE on the 0-1 scale, use `fmt.ratePct` instead.
   * Do NOT write `fmt.pct(rate01(x) * 100)`: `rate01` returns null for a
   * missing rate and `null * 100` is `0` in JavaScript, which resurrects the
   * fabricated zero this whole module exists to prevent.
   */
  pct(v: number | null | undefined, decimals = 1): string | null {
    return empty(v) ? null : `${group(v as number, decimals)}%`;
  },

  /**
   * A RATE on the 0-1 scale rendered as a percentage: 0.9432 -> "94%".
   * Sanitised through `rate01` first, so a missing rate returns null rather
   * than arithmetic-ing its way into a zero.
   */
  ratePct(v: number | null | undefined, decimals = 0): string | null {
    const r = rate01(v);
    return r === null ? null : `${group(r * 100, decimals)}%`;
  },

  /**
   * Milliseconds with their unit: 1490 -> "1,490ms". Matches how v3 renders
   * latency (`fmt.withUnit(e.latencyMs, 'ms')`, api-errors.html:520) and how
   * the live console renders it today (`${latencyMs}ms`), except that v3
   * groups the digits.
   */
  ms(v: number | null | undefined): string | null {
    return empty(v) ? null : `${group(Math.round(v as number), 0)}ms`;
  },

  /** Rupees, Indian grouping, symbol first, whole rupees unless asked.
   *  (v3 `AS.fmt.rupees`. No caller in the console today — declared here so
   *  the first money screen does not start a second formatter.) */
  money(v: number | null | undefined, decimals = 0): string | null {
    return empty(v) ? null : `₹${group(v as number, decimals)}`;
  },

  /** Land area: 28.4 -> "28.4 ac". The unit is plain text; styling it small
   *  is the component's job, not the formatter's. */
  acres(v: number | null | undefined, decimals = 1): string | null {
    return empty(v) ? null : `${group(v as number, decimals)} ac`;
  },

  /** A date. Pass a per-surface pattern from DATE_FORMATS — the defaults here
   *  are a fallback, not a house style. Unparseable input is a MISSING
   *  reading, so it returns null rather than throwing or printing garbage. */
  date(v: DateInput, pattern: string = DATE_FORMATS.churnLastLog): string | null {
    const d = toDate(v);
    return d === null ? null : formatDate(d, pattern);
  },

  /** A date with a clock time. */
  dateTime(v: DateInput, pattern: string = DATE_FORMATS.usersLastLogin): string | null {
    const d = toDate(v);
    return d === null ? null : formatDate(d, pattern);
  },

  /** A clock time on its own — for surfaces whose whole window is today. */
  time(v: DateInput, pattern: string = DATE_FORMATS.opsLiveRow): string | null {
    const d = toDate(v);
    return d === null ? null : formatDate(d, pattern);
  },

  /**
   * How long ago, as the 4-tier ramp the freshness chip has always used
   * (`FreshnessChip.tsx:12-19`): under a minute in seconds, under an hour in
   * minutes, under a day in hours, then days.
   *
   * TWO DELIBERATE DEVIATIONS from that original, both named in the Task 4
   * report rather than slipped in:
   *   1. missing input returns `null`, not `''` — the module's whole rule.
   *      Behaviour at the one existing call site is identical, because it
   *      reads `fmtAge(x) || 'recent'` and both '' and null are falsy.
   *   2. an UNPARSEABLE timestamp returns `null` too. The original computes
   *      `Date.now() - NaN` and falls through every branch to render
   *      "NaNd ago" — a freshness age it does not have, which is the D5
   *      defect class. FreshnessChip still carries that bug; it is fixed
   *      when the chip is migrated, not here.
   */
  age(v: DateInput, now: number = Date.now()): string | null {
    const d = toDate(v);
    if (d === null) return null;
    const ageMs = now - d.getTime();
    if (ageMs < 60_000) return `${Math.max(1, Math.floor(ageMs / 1000))}s ago`;
    if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
    if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
    return `${Math.floor(ageMs / 86_400_000)}d ago`;
  },
};

/**
 * A rate that is null, NaN or undefined is NOT a zero. Clamped to 0..1, and a
 * missing rate returns null so the caller renders an em dash.
 *
 * Lifted from the sanitisation inside `AiHealthBlock.tsx`'s `pct()` — the
 * console's only correct handling of this — so the honesty rule stops being a
 * formatter detail buried in one component (Preservation Register A38).
 * Behaviour is preserved exactly, INCLUDING the clamp: an out-of-range finite
 * rate is pulled to the nearest bound rather than rejected. That is what ships
 * today; changing it is a product decision, not a refactor.
 */
export function rate01(v: number | null | undefined): number | null {
  if (v === undefined || v === null || Number.isNaN(v)) return null;
  return Math.max(0, Math.min(1, v));
}

export type DateFormatKey = keyof typeof DATE_FORMATS;
