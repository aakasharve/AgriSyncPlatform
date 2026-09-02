import { useMemo } from 'react';
import { Activity, AlertTriangle, TrendingUp } from 'lucide-react';
import { DataList } from '@/components/data';
import type { DataListColumn } from '@/components/data';
import { NotMeasured } from '@/components/state';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { KpiCard } from '@/components/ui/KpiCard';
import { Disclosure } from '@/components/ui/Disclosure';
import type { KpiState, KpiTone } from '@/components/ui/KpiCard';
import { PersonName } from '@/components/ui/PersonName';
import {
  R9,
  R10,
  RULES_NOT_CHECKED_BY_OPS_HEALTH,
  ruleStateOf,
  type RuleState,
} from '@/lib/alertRules';
import { metaRefreshedAt } from '@/lib/api';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { ModuleKeys } from '@/lib/moduleKeys';
import { cn } from '@/lib/utils';
import { useAdminScope } from '@/hooks/useAdminScope';
import { useFarmsList } from '@/hooks/useFarms';
import { useOpsHealth, OPS_HEALTH_RECENT_CAP } from '@/hooks/useOpsHealth';
import type { OpsHealthData } from '@/hooks/useOpsHealth';
import { useShouldCallToday, type CallRow } from '@/hooks/useShouldCallToday';
import { useWvfd } from '@/hooks/useWvfd';

/**
 * HOME — "Ops Now". The last screen ported, because every tile on it is a
 * reading of a screen that was ported before it.
 *
 * ── THE THREE LIES THIS FILE USED TO TELL, DELETED TOGETHER ───────────────
 *
 *  D5 — FABRICATED FRESHNESS. Lines 18-19 were:
 *
 *         const now = new Date().toISOString();
 *         const lastNightly = new Date(Date.now() - 14 * 3600 * 1000).toISOString();
 *
 *       Four `FreshnessChip`s read from them, so this screen printed
 *       "Live · 1s ago" and "Nightly · 14h ago" on EVERY render, forever,
 *       OVER KPI CARDS THAT WERE EM DASHES. The chip was not reporting an age;
 *       it was reporting the clock. Both chips now take the SERVER's stamp —
 *       `computedAtUtc` for the live feed (this endpoint sends no envelope,
 *       A27) and `meta.lastRefreshedUtc` for the materialized ones — and a
 *       section with no stamp renders no chip rather than a better-looking one.
 *
 *       Only ONE of those two lines was ever a lint warning (`Date.now` is an
 *       impure call; `new Date()` is not). The line the linter never saw is the
 *       one that produced "Live · 1s ago". A lint rule caught half of a
 *       fabrication, which is the argument for the test in this screen's spec
 *       file rather than for trusting the warning count.
 *
 *  D6 — SCAFFOLDING COPY, SHIPPED TO A PRODUCTION OPERATOR. Three strings
 *       written for a developer reading a plan: "No activity yet — Phase 2
 *       wires this to /admin/ops/health", "Wired in Phase 2", "Chart renders in
 *       Phase 3 · wires to mis.wvfd_weekly". They were on admin.shramsafal.in.
 *       Same class as Live Health's "Start the .NET API on port 5001" (D7) and
 *       Settings' "Phase 6" note, both already deleted.
 *
 *  D8 — "all R1–R10 clear", OVER A HARDCODED `value={0}`. Ten rules reported
 *       clear by a screen that read none of them. Task 20 fixed Live Health's
 *       half and left this one: `/shramsafal/admin/ops/health` reads TWO views,
 *       R9 and R10, and has no state at all for R1–R8. This screen now counts
 *       what it read and says NOT CHECKED for the rest, in the same words and
 *       from the same declaration (`@/lib/alertRules`), so the two screens
 *       cannot drift apart about an alert.
 *
 * ── FOUR OF EIGHT TILES HAVE NO SOURCE, AND THE SCREEN SAYS SO ────────────
 * Verified against the endpoint list on 2026-09-01 (`AdminEndpoints.cs`:
 * eleven `MapGet`s, named in full):
 *
 *   Logs Today     no endpoint counts logs in a day. `/metrics/wvfd` counts
 *                  verified farm-DAYS per week; it is not a log count.
 *   D30 Retention  no endpoint — and `ModuleKey.MetricsRetention`
 *                  ("metrics.retention") EXISTS in the domain and gates
 *                  nothing. The entitlement for this number was declared and
 *                  the number was never built. Repo-wide, that key appears in
 *                  exactly two files: its own declaration and the TypeScript
 *                  mirror of it.
 *   MRR            no endpoint, and not computable from what is stored:
 *                  `Accounts.Domain.Subscriptions.Subscription` carries a plan
 *                  code, a status and two dates, and NO amount and NO currency.
 *   Voice / errors  see the two properties below — the endpoint carries less
 *                  than the plan's table assumed.
 *
 * A tile with no source renders through `NotMeasured`, never as a zero. The
 * `KpiCard` forced-grey rule from Task 3 makes that structural rather than a
 * habit: a tile whose `state` is not `ok` is painted grey and shows an em dash
 * no matter what tone the caller asks for, so this screen CANNOT paint an
 * unmeasured figure green even by mistake.
 *
 * ── 🛑 TWO PLACES THE PLAN'S TILE TABLE IS WRONG ABOUT THE ENDPOINT ───────
 *
 *  (1) THERE IS NO 24-HOUR API-ERROR COUNT ON `/ops/health`.
 *      `GetRecentErrorsAsync` (`AdminOpsRepository.cs:85-123`) is
 *      `event_type IN ('api.error','api.slow','client.error') AND
 *       occurred_at_utc >= NOW() - INTERVAL '2 hours' … LIMIT 50`. The 24-hour
 *      figure the plan asks for belongs to `/ops/errors`, a different endpoint
 *      behind a different module key (Task 18 found the same confusion pointing
 *      the other way). The tile therefore says TWO HOURS, because two hours is
 *      what was measured, and it counts `api.error` alone rather than calling
 *      three event types "API errors" — the mistake Task 16 corrected on
 *      Suffering.
 *
 *      The query ends `catch { /* graceful *\/ }` over a pre-declared empty
 *      list, so AN EMPTY ANSWER IS NOT A QUIET TWO HOURS. The tile treats a
 *      zero-length list as no reading, and a list that came back non-empty as
 *      proof the query ran — which makes "0 api.error rows among 12 events" a
 *      real measured zero and "0 events at all" an absence.
 *
 *  (2) "ACTIVE FARMS" IS NOT WHAT `totalCount` COUNTS.
 *      `SELECT COUNT(DISTINCT f.farm_id) FROM ssf.farms f`
 *      (`AdminMisRepository.cs:94`) — every farm row in the table. No activity
 *      filter, no status filter, no organisation filter (Task 14: this feed is
 *      not org-scoped, and the endpoint has no parameter to receive one). The
 *      tile is labelled **Farms on record**, which is what the number is.
 *      Its failure path is `catch { return new FarmsListDto([], 0, page,
 *      pageSize); }` (`:145` — Task 21's twelfth swallow site), so a 0 is the
 *      server's substitution as often as it is a reading and is rescued the
 *      same way `currentWvfd` is.
 *
 * ── WHAT THIS SCREEN DELIBERATELY DOES NOT SHOW ──────────────────────────
 * v3's "Recent activity" panel — the six most recent logs plus every farm that
 * has never logged. It is built in the prototype from `D.farms`, which carries
 * a village, a last-log timestamp and a complete farm list. The live feed is
 * SERVER-PAGINATED and ordered `COALESCE(w.wvfd,-1) DESC, f.created_at DESC`
 * (`AdminMisRepository.cs:125`) — not by last log — and carries no village. So
 * a port would fetch one arbitrary page and present it as "the most recent
 * logs", which is a fabricated ordering dressed as a finding. Building it
 * honestly needs an endpoint that sorts by last log; that is a backend task and
 * it is named here rather than left as an absence somebody rediscovers.
 *
 * ── FAIL CLOSED, BECAUSE THIS IS THE ONE UNGATED SCREEN (A4) ─────────────
 * Home carries no `EntitlementGuard`, on purpose: its tiles must 403
 * independently. But its five hooks hit five endpoints behind five DIFFERENT
 * module keys, and a denial invalidates the cached scope (`App.tsx`'s
 * `QueryCache.onError`) — which re-renders this screen, which asks again.
 * Every hook is gated on `canRead` so an unentitled reader issues no request at
 * all, and the tile says the feed was not asked for rather than claiming it was
 * measured. Task 13 closed the same loop on the command palette.
 */

/* ═══════════════════════════════════════════════════════ tile plumbing ══ */

/**
 * WHAT A TILE KNOWS. Three cases and they are not interchangeable:
 *
 *   a reading            — `value` is a formatted string.
 *   an absence           — `state` says which of the four causes.
 *   a feed not asked for — also an absence, but the CAPTION says the reader's
 *                          role is why, because "not measured" would be false:
 *                          it is measured, and not for them.
 */
interface Tile {
  label: string;
  value: string | null;
  state: KpiState;
  tone?: KpiTone;
  caption: string;
  note: string;
}

/** A figure the server may have substituted. `null` unless it is a number
 *  inside the range the field can actually take. */
function readingIn(value: number | null | undefined, max: number): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value >= 0 && value <= max ? value : null;
}

/** The words a tile uses when its feed was never requested. One sentence, one
 *  place, so five tiles cannot phrase a permission fact five ways. */
function notYours(grant: string): string {
  return `Not requested — this feed is gated on ${grant} and your role does not include it.`;
}

/* ═════════════════════════════════════════════════════ the section dots ══ */

/**
 * A COLOURED DOT ALONE IS UNDECODABLE, so every dot carries a WORD.
 *
 * The dot is what a sighted reader scans before reading a heading; the sentence
 * beside it is what a screen-reader user gets, and it is not a label for the
 * colour ("red") but a statement of the finding ("3 farms need a person
 * today"). Naming the colour would be a second way of saying the same nothing.
 *
 * WORST STATE WINS, and the order is written down rather than left to the order
 * the checks happen to run in:
 *
 *   attention  — something in this section needs a person.
 *   unmeasured — part of this section was never measured.
 *   healthy    — measured, and nothing is wrong.
 *
 * `null` is a fourth outcome and it is the important one: A SECTION WITH
 * NOTHING TO REPORT CARRIES NO DOT AT ALL. A dot that means nothing teaches a
 * reader to ignore all of them.
 */
type SectionState = 'attention' | 'unmeasured' | 'healthy';

const SECTION_RANK: Record<SectionState, number> = {
  attention: 0,
  unmeasured: 1,
  healthy: 2,
};

/**
 * NOT EXPORTED, and that is the same trade `honestState.ts` records: a value
 * export from a page file costs a `react-refresh/only-export-components`
 * warning, and a warning bought to give a test a seam is a bad trade when the
 * rendered screen is the stronger proof anyway. The dots are asserted through
 * the DOM — `data-section-dot` and the sentence beside it — which is what a
 * reader actually gets.
 */
function worstSectionState(
  ...states: (SectionState | null | undefined)[]
): SectionState | null {
  let worst: SectionState | null = null;
  for (const state of states) {
    if (!state) continue;
    if (worst === null || SECTION_RANK[state] < SECTION_RANK[worst]) worst = state;
  }
  return worst;
}

const SECTION_TONE: Record<SectionState, string> = {
  attention: 'bg-red',
  unmeasured: 'bg-text-3',
  healthy: 'bg-green',
};

function SectionHead({
  title,
  icon,
  state,
  words,
  meta,
}: {
  title: string;
  icon: React.ReactNode;
  state: SectionState | null;
  /** The finding, in words. Required whenever there is a state — a dot with no
   *  sentence is the thing this component exists to prevent. */
  words: string | null;
  meta: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1" data-section={title}>
      <h2 className="flex items-center gap-2 text-h2 font-bold text-text-1">
        {state && (
          <>
            <span
              data-section-dot={state}
              aria-hidden="true"
              className={cn('inline-block size-[9px] flex-none rounded-full', SECTION_TONE[state])}
            />
            <span className="sr-only">{words}</span>
          </>
        )}
        {/* A constant brand badge, identical in every section, so it cannot
            be read as encoding anything — the DOT beside it is the thing that
            varies and the thing that means something. Chrome supplying weight
            to a heading; the finding is still the dot plus the sentence. */}
        <span
          className="grid size-8 flex-none place-items-center rounded-chip bg-brand-wash text-brand"
          aria-hidden="true"
        >
          {icon}
        </span>
        {title}
      </h2>
      <div className="ml-auto flex items-center gap-2">{meta}</div>
    </div>
  );
}

/* ═════════════════════════════════════════════ the call list's columns ══ */

/**
 * `COALESCE(f.name, s.farm_id::text)` on Suffering and
 * `COALESCE(s.farm_name, 'Unknown')` on Silent Churn — TWO different name
 * sentinels on the two feeds this list merges, and neither is a name.
 *
 * Handing either to `PersonName` prints a guid, or the literal word Unknown, in
 * the Farm column and claims it is what the farm is called. Both are turned
 * back into the absence they stand for so the farm id renders as the fallback
 * it actually is.
 *
 * (Silent Churn's own screen does NOT do this yet — the `'Unknown'` sentinel
 * was not caught by Task 15. Named in this task's report; it needs that
 * screen's own assertions, not a drive-by edit from Home.)
 */
function nameOf(row: CallRow): string | null {
  const value = row.name?.trim();
  if (!value) return null;
  if (value === row.farmId) return null;
  if (value === 'Unknown') return null;
  return value;
}

const FLAG_TONE: Record<string, string> = {
  red: 'bg-tint-red text-red',
  amber: 'bg-tint-amber text-amber',
  grey: 'bg-tint-grey text-text-3',
};

const NO_EVENT_READING =
  'This farm is not on the suffering watchlist, so no event count was read for it. It is not a count of zero.';

const NO_SILENCE_READING =
  'This farm is not on the silent-churn watchlist, so no silence was measured for it. It is not a silence of zero weeks.';

const CALL_COLUMNS: DataListColumn<CallRow>[] = [
  {
    key: 'farm',
    label: 'Farm',
    render: (row) => <PersonName name={nameOf(row)} fallback={row.farmId} />,
  },
  {
    key: 'why',
    label: 'Why',
    render: (row) => (
      <span className="flex flex-wrap gap-1.5">
        {row.reasons.map((reason) => (
          <span
            key={reason.kind}
            data-flag={reason.kind}
            className={cn(
              'rounded-chip px-2.5 py-1 text-caption font-bold',
              FLAG_TONE[reason.tone],
            )}
          >
            {reason.label}
          </span>
        ))}
      </span>
    ),
    /* THE ORDER, DECLARED TWICE ON PURPOSE AND IDENTICALLY.
       `mergeCallList` already returns rows in this order, and `fixedSort`
       suppresses every header control — so nothing re-sorts. Spelling the same
       three keys here as well means that if the list component ever DOES sort
       this column, it produces byte-for-byte the same order rather than a
       second, silently different one. See `compareCallRows`. */
    sortType: 'num',
    sortValue: (row) => row.reasons.length,
    tiebreak: (a, b) => {
      const aw = a.churn?.weeksSilent ?? null;
      const bw = b.churn?.weeksSilent ?? null;
      if (aw !== bw) {
        if (aw === null) return 1;
        if (bw === null) return -1;
        return bw - aw;
      }
      return a.name.localeCompare(b.name);
    },
    defaultDir: 'desc',
  },
  {
    /* TASK 16'S NAME, NOT "ERRORS". `error_count` is a bare `COUNT(*)` that
       admits successful AI calls; the entry condition beside it is clean. The
       header says what the figure counts and the note under the table says why
       it is not what ordered the list. */
    key: 'events',
    label: 'Events counted',
    align: 'right',
    render: (row) =>
      row.suffering ? (
        <span className="font-semibold">{fmt.num(row.suffering.errorCount)}</span>
      ) : (
        <NotMeasured why={NO_EVENT_READING} />
      ),
    state: (row) => (row.suffering ? null : 'unmeasured'),
  },
  {
    key: 'silence',
    label: 'Silent',
    align: 'right',
    render: (row) =>
      row.churn ? (
        <span className="font-semibold">{fmt.num(row.churn.weeksSilent)}w</span>
      ) : (
        <NotMeasured why={NO_SILENCE_READING} />
      ),
    state: (row) => (row.churn ? null : 'unmeasured'),
  },
  {
    key: 'lastLog',
    label: 'Last log',
    render: (row) => {
      const source = row.churn ?? row.heldOut;
      const when = source ? fmt.date(source.lastLogAt, DATE_FORMATS.churnLastLog) : null;
      return when ?? <NotMeasured why={NO_LAST_LOG} />;
    },
    state: (row) => {
      const source = row.churn ?? row.heldOut;
      return source && fmt.date(source.lastLogAt, DATE_FORMATS.churnLastLog) ? null : 'unmeasured';
    },
  },
];

const NO_LAST_LOG =
  'Only the silent-churn feed carries a last log, and this farm did not arrive on it. Nothing here says the farm has never logged.';

/** The prose under an opened row. Every sentence is derived from a field; none
 *  is typed prose about a farm and none is a threshold nobody has set. */
function callDetail(row: CallRow) {
  const parts: string[] = [];

  if (row.suffering) {
    const s = row.suffering;
    parts.push(
      `On the suffering watchlist: three or more failed events in the last seven days. ` +
        `${fmt.num(s.errorCount)} events were counted in total — a figure that also includes ` +
        `successful AI calls — of which ${fmt.num(s.syncErrors)} matched the sync filter, ` +
        `${fmt.num(s.logErrors)} the log filter and ${fmt.num(s.voiceErrors)} the voice filter. ` +
        `Those three are failure counts and they are the trustworthy ones. The most recent event ` +
        `counted was ${fmt.date(s.lastErrorAt, DATE_FORMATS.sufferLastErr) ?? 'at an unreported time'}.`,
    );
  }

  if (row.churn) {
    parts.push(
      `On the silent-churn watchlist: no log recorded for more than 14 days, which floors to ` +
        `${fmt.num(row.churn.weeksSilent)} full ${row.churn.weeksSilent === 1 ? 'week' : 'weeks'}. ` +
        `The subscription is ${row.churn.plan} and the last log was ` +
        `${fmt.date(row.churn.lastLogAt, DATE_FORMATS.churnLastLog) ?? 'not reported'}.`,
    );
    if (!row.suffering) {
      parts.push(
        'No error explains the silence — this farm is not on the suffering watchlist, so the ' +
          'platform reported no fault here. Somebody has to ask.',
      );
    }
  }

  if (row.heldOut) {
    parts.push(
      'This row arrived from the silent-churn feed with no last log at all, so there is nothing ' +
        'to count silence back from. It is not silent for zero weeks and not silent for many — it ' +
        'is held apart from the watchlist rather than folded into it.',
    );
  }

  parts.push(
    'Nothing in this product marks a farm called, contacted or resolved. A farm leaves this list ' +
      'when its events age out of the seven-day window or it logs again, whether or not anyone ' +
      'spoke to the farmer.',
  );

  return <p className="text-body text-text-2">{parts.join(' ')}</p>;
}

/* ═════════════════════════════════════════════════════════ the screen ══ */

/** Twelve weeks, as the plan's hook list specifies. Named so the tile's own
 *  copy and the request cannot disagree about the window. */
const HOME_WVFD_WEEKS = 12;

/** `wvfd = COUNT of IST days in the week, capped at 7` — the field's ceiling,
 *  used to reject a value that cannot be a reading of it. */
const WVFD_MAX = 7;

export default function HomePage() {
  const { canRead } = useAdminScope();
  const mayReadOps = canRead(ModuleKeys.OpsLive);
  const mayReadWvfd = canRead(ModuleKeys.MetricsNsm);
  const mayReadFarms = canRead(ModuleKeys.FarmsList);

  const health = useOpsHealth({ enabled: mayReadOps });
  const wvfd = useWvfd(HOME_WVFD_WEEKS, { enabled: mayReadWvfd });
  /* One row, for the count that comes beside it. The page size is 1 because
     the FIGURE is what this screen wants; the row it returns is used only to
     tell a real 0 from the server's substituted one. */
  const farms = useFarmsList(1, 1, undefined, undefined, { enabled: mayReadFarms });
  const call = useShouldCallToday();

  /* ── Ops Now ─────────────────────────────────────────────────────────── */

  const ops = health.data;
  /* A27, THE SECOND HALF. The SERVER's stamp. `dataUpdatedAt` is the moment we
     were answered, which is never more than milliseconds old and says nothing
     about the snapshot's age. */
  const opsStamp = ops?.computedAtUtc;
  const opsReadAt = fmt.dateTime(opsStamp, DATE_FORMATS.usersLastLogin);
  const opsCheckedAt = opsReadAt ?? 'a time the server did not report';

  const r9State: RuleState = ops ? ruleStateOf(ops.apiErrorSpike) : 'unread';
  const r10State: RuleState = ops ? ruleStateOf(ops.voiceDegraded) : 'unread';
  const ruleStates = [r9State, r10State];
  const breaches = ruleStates.filter((s) => s === 'breach').length;
  const readHere = ruleStates.filter((s) => s === 'breach' || s === 'clear').length;

  const alerts = useMemo<Tile>(() => {
    if (!mayReadOps) {
      return {
        label: 'Active alerts',
        value: null,
        state: 'unmeasured',
        caption: notYours(ModuleKeys.OpsLive),
        note: `${R9.id} and ${R10.id} are the only rules this feed reads. ${RULES_NOT_CHECKED_BY_OPS_HEALTH.id} are NOT CHECKED here whatever your role.`,
      };
    }
    /* A count is claimable when every rule this endpoint reads gave an answer,
       OR when at least one of them said BREACH — a known breach is a finding
       and reporting "not measured" over it would be the worse error. */
    const countable = ops !== undefined && (readHere === ruleStates.length || breaches > 0);
    return {
      label: 'Active alerts',
      value: countable ? fmt.num(breaches) : null,
      state: countable ? 'ok' : 'unmeasured',
      tone: breaches > 0 ? 'red' : 'green',
      caption: countable
        ? `${fmt.num(readHere)} of ${fmt.num(ruleStates.length)} rules read at ${opsCheckedAt}`
        : `neither ${R9.id} nor ${R10.id} could be read on this request`,
      /* D8, in one sentence, and it is why this tile may show a green 0. */
      note: `Counts only ${R9.id} (${R9.rule}) and ${R10.id} (${R10.rule}). ${RULES_NOT_CHECKED_BY_OPS_HEALTH.id} — ${RULES_NOT_CHECKED_BY_OPS_HEALTH.rule} — are NOT CHECKED: this endpoint does not read them, so a zero here is not "no alerts".`,
    };
  }, [mayReadOps, ops, readHere, breaches, ruleStates.length, opsCheckedAt]);

  const recent = ops?.recentErrors ?? [];
  /* THE ONLY PROOF THE QUERY RAN. Its catch returns the empty list it declared
     before the try, so zero rows and a failed read are the same response. */
  const recentAnswered = recent.length > 0;
  const recentCapped = recent.length >= OPS_HEALTH_RECENT_CAP;
  const apiErrors = recent.filter((e) => e.eventType === 'api.error').length;

  const errorsTile: Tile = !mayReadOps
    ? {
        label: 'API errors · last 2 hours',
        value: null,
        state: 'unmeasured',
        caption: notYours(ModuleKeys.OpsLive),
        note: 'The full paginated list lives on API Errors, behind its own grant.',
      }
    : {
        label: 'API errors · last 2 hours',
        value: recentAnswered ? fmt.num(apiErrors) : null,
        state: recentAnswered ? 'ok' : 'unmeasured',
        tone: apiErrors > 0 ? 'red' : 'blue',
        caption: recentAnswered
          ? recentCapped
            ? `at least — the server sent its ${fmt.num(OPS_HEALTH_RECENT_CAP)}-row maximum, read at ${opsCheckedAt}`
            : `out of ${fmt.num(recent.length)} events read at ${opsCheckedAt}`
          : 'the feed returned no events at all, which is also what it returns when the query fails',
        note: 'Two hours, not twenty-four — that is the window this endpoint reads. It also returns api.slow and client.error, which are not API errors and are not counted here.',
      };

  /* The five-zero rescue Task 20 established: the voice query's catch block
     substitutes (0,0,0,0,0), so all five arriving together is the signature of
     a failure, not of a quiet day. */
  const voiceUnreadable = ops ? voiceIsUnreadable(ops) : false;
  const invocations = ops && !voiceUnreadable ? ops.voiceInvocations24h : null;
  /* A rate needs a denominator. With no calls the server sends 0 because of its
     own COALESCE, not because nothing failed. */
  const failureRate =
    ops && !voiceUnreadable && ops.voiceInvocations24h > 0 ? ops.voiceFailureRatePct : null;
  const successRate = failureRate === null ? null : 100 - failureRate;

  const voiceTile: Tile = !mayReadOps
    ? {
        label: 'AI call success · 24h',
        value: null,
        state: 'unmeasured',
        caption: notYours(ModuleKeys.OpsLive),
        note: `The rule that judges it, ${R10.id}, is on Live Health behind the same grant.`,
      }
    : {
        label: 'AI call success · 24h',
        value: fmt.pct(successRate),
        state: successRate === null ? 'unmeasured' : 'ok',
        /* STEP 4 — THE TONE COMES FROM THE RULE, NOT FROM THE FIGURE.
           Without this, Ops Now painted green the exact reading the Active
           Alerts tile beside it was counting as a breach. Amber, never green,
           while R10 is breached; and never green when it is not, either —
           Live Health refuses to paint a verdict on this figure at all,
           because R10 reads six hours and this covers twenty-four, and Home
           may not contradict a caveat a ported screen already carries. What
           the colour says is "the rule beside this tile is breached", never
           "this number is bad". */
        tone: r10State === 'breach' ? 'amber' : 'blue',
        caption:
          invocations !== null && invocations > 0
            ? `over ${fmt.num(invocations)} AI calls read at ${opsCheckedAt}`
            : voiceUnreadable
              ? 'all five voice figures came back as zero, which is also what the query returns when it fails'
              : 'no AI call was measured in this window',
        note:
          r10State === 'breach'
            ? `${R10.id} · ${R10.name} is in BREACH — ${R10.rule}. That rule reads a six-hour window and this figure covers twenty-four, so it is not the same reading; the tone is the rule's, not this number's.`
            : 'Not only voice: receipt and patti extractions are the same kind of call and are inside this figure. Nothing here measures whether a call that completed understood the farmer.',
      };

  const logsTile: Tile = {
    label: 'Logs today',
    value: null,
    state: 'unmeasured',
    caption: 'there is no endpoint behind this tile',
    note: 'Nothing in the admin API counts logs in a day. WVFD counts verified farm-days per week, which is a different measurement over a different window. This is an absence, not a zero.',
  };

  /* ── Business ────────────────────────────────────────────────────────── */

  const history = wvfd.data?.data;
  const wvfdStamp = metaRefreshedAt(wvfd.data?.meta);
  const wvfdWeeks = history?.weeks ?? [];
  /* Property (5) on the North Star screen: `currentWvfd` is `0m` when there are
     no weeks at all, and the failure path returns a complete set of numbers.
     Believed only when a week on the axis could have been its average. */
  const currentWvfd = wvfdWeeks.length > 0 ? readingIn(history?.currentWvfd, WVFD_MAX) : null;
  const goalWvfd = readingIn(history?.goalWvfd, WVFD_MAX);

  const wvfdTile: Tile = !mayReadWvfd
    ? {
        label: 'WVFD',
        value: null,
        state: 'unmeasured',
        caption: notYours(ModuleKeys.MetricsNsm),
        note: 'The North Star metric and its twelve-week history are on WVFD, behind that grant.',
      }
    : {
        label: 'WVFD',
        value: fmt.num(currentWvfd, 1),
        state: currentWvfd === null ? 'unmeasured' : 'ok',
        /* Never green. The headline week is always partial, so a verdict on it
           is a verdict on how far through the week it is. */
        tone: 'blue',
        caption:
          currentWvfd === null
            ? 'no week in the window carries a reading'
            : goalWvfd !== null
              ? `goal ${fmt.num(goalWvfd, 1)} — a constant in the API, not a setting`
              : `newest of ${fmt.num(wvfdWeeks.length)} weeks read`,
        note: 'The newest week is always partial, so this figure climbs through the week and falls every Monday. Its denominator is farms that LOGGED, so it also rises when the least engaged farms leave.',
      };

  const farmsList = farms.data?.data;
  const farmsTotal = farmsList?.totalCount ?? null;
  /* `catch { return new FarmsListDto([], 0, …) }` — a 0 with no row beside it
     is the substituted answer as often as it is an empty platform. */
  const farmsAnswered =
    farmsList !== undefined && ((farmsTotal ?? 0) > 0 || farmsList.items.length > 0);

  const farmsTile: Tile = !mayReadFarms
    ? {
        label: 'Farms on record',
        value: null,
        state: 'unmeasured',
        caption: notYours(ModuleKeys.FarmsList),
        note: 'The list this figure counts is on All Farms, behind that grant.',
      }
    : {
        label: 'Farms on record',
        value: farmsAnswered ? fmt.num(farmsTotal) : null,
        state: farmsAnswered ? 'ok' : 'unmeasured',
        tone: 'blue',
        caption: farmsAnswered
          ? 'every farm row, counted by the server'
          : 'the feed answered with no rows and a count of zero, which is also its failure path',
        note: 'NOT "active farms": the count has no activity filter, no status filter and no organisation filter — this endpoint takes no organisation at all, so the figure is platform-wide whichever org is selected.',
      };

  const retentionTile: Tile = {
    label: 'D30 retention',
    value: null,
    state: 'unmeasured',
    caption: 'there is no endpoint behind this tile',
    note: 'Never built. The entitlement for it exists — ModuleKey "metrics.retention" is declared in the domain — and it gates nothing, because there is nothing to gate.',
  };

  const mrrTile: Tile = {
    label: 'MRR',
    value: null,
    state: 'unmeasured',
    caption: 'there is no endpoint behind this tile',
    note: 'Never built, and not computable from what is stored: a subscription record carries a plan code, a status and two dates. It carries no amount and no currency.',
  };

  /* ── the call list ───────────────────────────────────────────────────── */

  const churnStamp = metaRefreshedAt(call.churn.data?.meta);
  const sufferingStamp = metaRefreshedAt(call.suffering.data?.meta);
  const callReadAt = fmt.dateTime(churnStamp ?? sufferingStamp, DATE_FORMATS.usersLastLogin);
  /* Qualified for the reason Suffering qualifies it: `meta.lastRefreshed` is
     `DateTime.UtcNow` taken as the request is served, over matviews rebuilt
     once a night. Saying only "checked at 08:30" would claim the watchlists
     were recomputed at 08:30. */
  const callCheckedAt = callReadAt
    ? `${callReadAt}, though both watchlists are rebuilt only once a night`
    : 'a time the server did not report';

  const callLoading =
    (call.mayReadSuffering && call.suffering.isLoading) ||
    (call.mayReadChurn && call.churn.isLoading);
  const callFetching = call.suffering.isFetching || call.churn.isFetching;
  const callFeedDown =
    (call.mayReadSuffering && call.suffering.isRefetchError) ||
    (call.mayReadChurn && call.churn.isRefetchError);
  const callError =
    (call.mayReadSuffering && call.suffering.isLoadingError ? call.suffering.error : null) ??
    (call.mayReadChurn && call.churn.isLoadingError ? call.churn.error : null);
  const noWatchlistReadable = !call.mayReadSuffering && !call.mayReadChurn;

  /* ── the dots ────────────────────────────────────────────────────────── */

  const opsTiles = [alerts, errorsTile, voiceTile, logsTile];
  const opsUnmeasured = opsTiles.filter((t) => t.state !== 'ok').length;
  const opsSection: SectionState | null = !mayReadOps
    ? null
    : worstSectionState(
        breaches > 0 ? 'attention' : null,
        opsUnmeasured > 0 ? 'unmeasured' : null,
        'healthy',
      );
  const opsWords =
    breaches > 0
      ? `${fmt.num(breaches)} of the ${fmt.num(ruleStates.length)} rules this feed reads ${breaches === 1 ? 'is' : 'are'} breached`
      : opsUnmeasured > 0
        ? `${fmt.num(opsUnmeasured)} of these ${fmt.num(opsTiles.length)} figures have no reading`
        : 'every figure in this band is measured and no rule this feed reads is breached';

  const businessTiles = [wvfdTile, farmsTile, retentionTile, mrrTile];
  const businessUnmeasured = businessTiles.filter((t) => t.state !== 'ok').length;
  /* Always grey today, and that is a finding rather than a bug: two of these
     four have never been built, so the band cannot be green whatever the other
     two report. */
  const businessSection = worstSectionState(
    businessUnmeasured > 0 ? 'unmeasured' : null,
    'healthy',
  );
  const businessWords =
    businessUnmeasured > 0
      ? `${fmt.num(businessUnmeasured)} of these ${fmt.num(businessTiles.length)} figures have no reading`
      : 'every figure in this band is measured';

  const attentionSection: SectionState | null = noWatchlistReadable
    ? null
    : worstSectionState(
        call.rows.length > 0 ? 'attention' : null,
        callFeedDown || callError !== null || call.badgeCount === null ? 'unmeasured' : null,
        'healthy',
      );
  const attentionWords =
    call.rows.length > 0
      ? `${fmt.num(call.rows.length)} ${call.rows.length === 1 ? 'farm needs' : 'farms need'} a person today`
      : call.badgeCount === null
        ? 'the watchlists behind this list did not both answer'
        : 'no farm needs a person today';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-h1 font-bold text-text-1">Ops Now</h1>
          <p className="mt-1 text-body text-text-2">
            What the platform is doing right now, who needs a person today, and what it cannot tell
            you. Four of the eight figures below have no source at all and say so; none of the
            others is scoped to one organisation, because none of these endpoints takes one.
          </p>
        </div>
      </div>

      {/* ── OPS NOW ─────────────────────────────────────────────────────── */}
      <SectionHead
        title="Ops now"
        icon={<Activity size={18} strokeWidth={2} />}
        state={opsSection}
        words={opsWords}
        meta={
          !mayReadOps ? (
            <span className="text-caption text-text-3">feed not requested at your role</span>
          ) : opsStamp ? (
            <FreshnessChip source="live" lastRefreshed={opsStamp} />
          ) : (
            /* NO CHIP WITHOUT A STAMP. This is the D5 deletion in one line: a
               chip here used to read "Live · 1s ago" off the browser's clock. */
            <span className="text-caption text-text-3">no server timestamp</span>
          )
        }
      />
      <TileGrid tiles={opsTiles} name="ops" />

      {/* ── BUSINESS ────────────────────────────────────────────────────── */}
      <SectionHead
        title="Business"
        icon={<TrendingUp size={18} strokeWidth={2} />}
        state={businessSection}
        words={businessWords}
        meta={
          wvfdStamp ? (
            <FreshnessChip source="materialized" lastRefreshed={wvfdStamp} />
          ) : (
            <span className="text-caption text-text-3">no server timestamp</span>
          )
        }
      />
      <TileGrid tiles={businessTiles} name="business" />

      {/* ── NEEDS ATTENTION ─────────────────────────────────────────────── */}
      <SectionHead
        title="Needs attention"
        icon={<AlertTriangle size={18} strokeWidth={2} />}
        state={attentionSection}
        words={attentionWords}
        meta={
          noWatchlistReadable ? (
            <span className="text-caption text-text-3">feeds not requested at your role</span>
          ) : churnStamp || sufferingStamp ? (
            <FreshnessChip
              source="materialized"
              lastRefreshed={churnStamp ?? sufferingStamp}
            />
          ) : (
            <span className="text-caption text-text-3">no server timestamp</span>
          )
        }
      />

      {noWatchlistReadable ? (
        <p className="rounded-panel bg-tint-grey px-5 py-4 text-body text-text-2">
          This list merges the suffering watchlist and the silent-churn watchlist. Your role
          includes neither {ModuleKeys.FarmsSuffering} nor {ModuleKeys.FarmsSilentChurn}, so neither
          feed was requested. Nothing here is a count of zero.
        </p>
      ) : (
        <>
          <DataList<CallRow>
            id="should-call-today"
            label="Farms a person should call today"
            caption="Every farm either watchlist flagged, once each, carrying every reason it was flagged, the events counted against it, the number of whole silent weeks and the date of its last log. Select a row to open its detail."
            noun={{ one: 'farm', many: 'farms' }}
            rows={call.rows}
            rowKey={(row) => row.farmId}
            columns={CALL_COLUMNS}
            pagination={{ mode: 'none' }}
            expand={callDetail}
            /* NO ROW EDGE. `ExpandableRow`'s own rule is that an edge marks the
               rows that need a person and is decoration on every row — and
               every row here needs a person by definition. The pills already
               carry the reason, in words, per row. */
            fixedSort={{
              key: 'why',
              dir: 'desc',
              because:
                'Ordered by how many watchlists flagged the farm, then by the longest silence, then by name. It is deliberately NOT ordered by the event count — see the note below.',
            }}
            states={{
              isLoading: callLoading,
              isFetching: callFetching,
              error: callError,
              onRetry: () => {
                if (call.mayReadSuffering) void call.suffering.refetch();
                if (call.mayReadChurn) void call.churn.refetch();
              },
              measuredZero: {
                what: 'farms need a person today',
                checkedAt: callCheckedAt,
                /* NOT a measured zero, and both feeds are why. Each repository
                   method ends `catch { return []; }`
                   (`AdminMisRepository.cs:219` and `:245`), so a dropped
                   connection, a missing matview or a permission failure on the
                   `mis` schema arrives here as an empty list with HTTP 200. On
                   THIS screen an empty list is the best possible news, which
                   makes it the worst thing to print over a broken endpoint. */
                unproven: (
                  <>
                    Both watchlists answer an internal failure with an empty list and a success
                    code, so an empty answer here cannot be claimed as a measured zero. What is
                    true is that neither feed named a farm on this request, at {callCheckedAt}.
                  </>
                ),
              },
              feedDown: callFeedDown
                ? {
                    since: callCheckedAt,
                    lastGood: `${fmt.num(call.rows.length)} farms flagged at ${callCheckedAt}`,
                  }
                : undefined,
            }}
            skeleton={{ rows: 5, cells: 5 }}
          />

          <div className="flex flex-col gap-3">
            {/* 🛑 THIS ONE STAYS OPEN, AND IT IS THE EXCEPTION THE DISCLOSURE
                rollout is allowed exactly one of per screen.

                Everything else under this table folded on 2026-09-02. This did
                not, because it is not background — it is a CORRECTION TO THE
                COLUMN STANDING RIGHT BESIDE IT. "Events counted" is a number a
                reader will otherwise take at face value, and taking it at face
                value means ringing the busiest, happiest farmer on the
                platform. A caveat that changes how the figure next to it should
                be read cannot be one click away, because the misreading takes
                no clicks at all. */}
            <p className="max-w-[var(--text-measure)] text-caption text-text-2">
              <b>The &ldquo;Events counted&rdquo; column is not a count of problems.</b> It counts
              every AI action on that farm &mdash; the ones that worked as well as the ones that
              failed &mdash; so a farm that uses voice a lot has a big number here whether or not
              anything is wrong. That is why this list is <b>not</b> sorted by it. Being ON the list
              is still trustworthy: a farm only gets here after real failures or real silence.
            </p>
            <Disclosure
              variant="inline"
              name="how-this-list-is-built"
              label="How this list is built"
            >
              <p>
                A farm appears here for one of two reasons. Either it is <b>struggling</b> &mdash;
                three or more things failed for it in the last seven days &mdash; or it has gone{' '}
                <b>quiet</b> &mdash; nobody has recorded anything on it for more than 14 days, while
                it is still on a paying or trialling plan. A farm with both problems is listed once
                and shows both reasons.
              </p>
              <p>
                The full lists live on the Suffering and Silent Churn screens. Each of those sends
                at most 50 farms, so treat this as today&rsquo;s worklist rather than a total.
              </p>
              <p>
                The order is: farms flagged for both reasons first, then the longest silence, then
                alphabetically. It is deliberately not the events column, for the reason above.
              </p>
              {call.mayReadSuffering !== call.mayReadChurn && (
                <p>
                  Your account can see one of the two lists, not both, so what you are looking at is
                  what {call.mayReadSuffering ? 'the struggling-farms list' : 'the gone-quiet list'}{' '}
                  reports and nothing else.
                </p>
              )}
              {call.heldOut.length > 0 && (
                <p>
                  {fmt.num(call.heldOut.length)} of these farms arrived with no &ldquo;last
                  log&rdquo; date at all, so we cannot say how long they have been quiet. They are
                  marked apart rather than counted as quiet for zero weeks, which would not be true.
                </p>
              )}
            </Disclosure>
          </div>
        </>
      )}
    </div>
  );
}

/** All five voice figures arriving as zero is the signature of the query's
 *  `catch`, which substitutes `(0,0,0,0,0)` and still answers 200. Task 20
 *  established it on Live Health; the same reading must not be believed here
 *  and disbelieved there. */
function voiceIsUnreadable(data: OpsHealthData): boolean {
  return (
    data.voiceInvocations24h === 0 &&
    data.voiceFailures24h === 0 &&
    data.voiceFailureRatePct === 0 &&
    data.voiceAvgLatencyMs === 0 &&
    data.voiceP95LatencyMs === 0
  );
}

function TileGrid({ tiles, name }: { tiles: Tile[]; name: string }) {
  return (
    <div data-kpis={name} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <KpiCard
          key={tile.label}
          label={tile.label}
          /* A `null` value never reaches the tile as text: `state` is not `ok`
             whenever it is null, and `KpiCard` then renders the em dash and the
             state word itself. The value is passed anyway so the two can never
             be wired up out of step. */
          value={tile.value}
          state={tile.state}
          tone={tile.tone}
          caption={tile.caption}
          note={tile.note}
        />
      ))}
    </div>
  );
}
