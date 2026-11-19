import { ModuleKeys } from '@/lib/moduleKeys';
import type {
  Bucket,
  FarmerHealthAiHealthDto,
  FarmerHealthScoreBreakdownDto,
  FarmerHealthSyncStateDto,
  Flag,
} from './farmer-health.types';

/**
 * WHAT THE MODE A DRILLDOWN PAYLOAD ACTUALLY IS — read out of the endpoint,
 * the handler and the repository on 2026-09-01, not out of the plan and not
 * out of the v3 prototype, which has no drilldown at all.
 *
 * `./cohort.ts` carries the six properties of the SCORE and is shared with the
 * landing. This file carries the six that belong to the SINGLE-FARM RESPONSE.
 *
 * Read:
 *   `AdminFarmerHealthEndpoints.cs:52-73`          the route and its 404
 *   `GetFarmerHealthHandler.cs:45-58`              the (missing) envelope
 *   `AdminFarmerHealthRepository.cs:45-441`        eight queries, ten `catch`
 *   `ResponseRedactor.cs` + `RedactionMatrix.cs`   what redaction reaches here
 *   `20260817150453_WvfdWeekBoundaryToIst.cs:212`  what the score IS
 *
 * ── (1) 🔴 THE ops:read GATE IS TWO MODULE KEYS, AND NEITHER IS `ops.live` ─
 * The page gated Band 5 on `canRead(ModuleKeys.OpsLive)`. The SERVER decides
 * the same thing on two different keys, independently, one per block
 * (`AdminFarmerHealthRepository.cs:80-85`):
 *
 *     syncState = scope.CanRead(ModuleKey.OpsErrors) ? … : null
 *     aiHealth  = scope.CanRead(ModuleKey.OpsVoice)  ? … : null
 *
 * So the single `ops.live` gate was wrong in BOTH directions, and one of them
 * is the exact failure its own comment says the gate exists to prevent:
 *   - `ops.live` WITHOUT `ops.errors` rendered `SyncStateBlock` over a
 *     server-nulled sub-block — "No sync activity recorded." printed at an
 *     admin who had in fact been denied it. That is a server-redacted null
 *     rendered as data;
 *   - `ops.errors` WITHOUT `ops.live` showed the denial panel to somebody the
 *     server had just answered in full.
 * The gate is preserved — a second, finer permission layer inside a page that
 * already passed a route guard — and repointed at the keys that decide it.
 *
 * ── (2) 🔴 A FARM WITH NO SCORE ROW IS SENT AS A COMPLETE ZERO ────────────
 * `GetScoreAsync` swallows its own failure and `EmptyScore()`
 * (`AdminFarmerHealthRepository.cs:203-208`) returns:
 *
 *     Total 0 · Bucket "intervention" · Flag "insufficient_data"
 *     · all six pillars 0 · WeekStart = TODAY
 *
 * — a full, well-formed score row assembled from nothing, including a week
 * boundary that is not a week boundary. Drawn literally that is a 64px `0`
 * under an INTERVENTION badge for a farm nobody has ever scored. And since
 * `mis.dwc_score_per_farm_week` has never been populated in production
 * (property 5 in `./cohort.ts`), that is what every farm renders as today.
 *
 * `insufficient_data` is the one honest signal in it, and it IS in this DTO —
 * unlike the cohort feed, where the flag is absent entirely. So this screen
 * can do what the landing cannot: refuse to draw the total at all.
 *
 * ── (3) 🛑 THE PILLARS DO NOT ADD UP TO THE TOTAL, BY DESIGN ─────────────
 * `score = Σ pillars − (suspicious ? 30 : 0)`, and the subtraction happens
 * before the bucket is decided. A reader adding six bars on a flagged farm
 * gets a number thirty higher than the one printed beside them, with nothing
 * on screen saying why. The card says why.
 *
 * ── (4) 🔴 AI HEALTH FABRICATES A CLEAN BILL OF HEALTH ───────────────────
 * `GetAiHealthAsync` returns `(1m, 1m, 0)` from its `catch`, and its SQL
 * COALESCEs both ratios to `1.0` on a zero denominator
 * (`AdminFarmerHealthRepository.cs:392-424`). So "voice parse 100%" is exactly
 * what a broken query, an empty window and a genuinely perfect farm all look
 * like. A38 registers the fabricated ZERO; the live fabrication here points
 * the other way and is worse, because 100% is the reading nobody questions.
 * With no invocations there is no rate, and this screen says so.
 *
 * ── (5) 🛑 "PENDING PUSHES" IS A CONSTANT, NOT A MEASUREMENT ─────────────
 * `PendingPushes: 0, // server-side cannot observe device-side queue depth`
 * (`AdminFarmerHealthRepository.cs:386`). It was rendered as a figure, with a
 * conditional amber tone that can never fire. It is not a reading, and it is
 * drawn as one of T5's four causes instead.
 *
 * ── (6) 🔴 THE REDACTOR REACHES NOTHING HERE EITHER (A14) ────────────────
 * The handler does call `IResponseRedactor` (`GetFarmerHealthHandler.cs:56`),
 * and it changes nothing on this payload: `RedactionMatrix` names six fields
 * and `farmerName` / `phone` are not among them, in any role. The literal
 * `**redacted**` appears nowhere in the C# outside one doc comment. So a
 * farmer's name here is FULL PII today. The rendering stays redaction-tolerant
 * anyway — that is the half a frontend can own, and it must not have to change
 * on the day the server starts masking. **Do not tick B16.**
 */

/* ═════════════════════════════════════════════════ the gaming subtraction ═ */

/** From the matview's own `CASE WHEN suspicious THEN 30 ELSE 0 END`. */
export const SUSPICION_PENALTY = 30;

/* ════════════════════════════════════════════════════════════ the bucket ═ */

/**
 * ONE definition of the band badge.
 *
 * It had two — `DwcScoreCard.tsx:63-67` and `FarmerHealthDrilldown.tsx:41-45`
 * — and the drilldown's copy carried a comment admitting it: *"Second copy of
 * DwcScoreCard's bucket tones … C7's teal had two homes and only one of them
 * carried the sentence saying why."* The fix for a constraint with two homes
 * is one home, not a comment on each.
 *
 * `healthy` is C7: it tops out at teal (`--color-pillar-good`) and never
 * reaches a bright green, so a good reading can never be mistaken for a
 * celebration.
 */
export const BUCKET: Record<Bucket, { label: string; className: string }> = {
  intervention: { label: 'Intervention', className: 'bg-tint-red text-red' },
  watchlist: { label: 'Watchlist', className: 'bg-tint-amber text-amber' },
  healthy: { label: 'Healthy', className: 'bg-tint-green text-pillar-good' },
};

/* ══════════════════════════════════════════════════════════════ the flag ═ */

export interface FlagNotice {
  /** `alert` for the two that are findings; `status` for the one that is an
   *  absence of findings. A screen-reader user should not be interrupted to be
   *  told that nothing was measured. */
  role: 'alert' | 'status';
  title: string;
  body: string;
}

/**
 * THREE OF THE FOUR FLAG VALUES REACHED THE SCREEN AS NOTHING.
 *
 * The DTO carries `ok | flagged | suspicious | insufficient_data`
 * (`FarmerHealthScoreBreakdownDto.cs:33`) and the page rendered a banner for
 * `suspicious` only. `flagged` — one anti-gaming signal of three — and
 * `insufficient_data` — the score is not a reading at all — were dropped
 * silently, which is the worse of the two to drop: it is the one that says the
 * big number above it means nothing.
 *
 * The signals are `signal_time_static`, `signal_too_fast_verify` and
 * `signal_perfect_record`; `signal_gps_static` is hard-coded FALSE pending
 * PostGIS, so N is 3 and not 4 (`20260505000000_DwcV2Matviews.cs:141-196`).
 * `suspicious` is two of them, `flagged` is one.
 */
export const FLAG_NOTICE: Record<Exclude<Flag, 'ok'>, FlagNotice> = {
  suspicious: {
    role: 'alert',
    title: 'This farm shows gaming signals.',
    body:
      'Two or more of three anti-gaming signals fired — logs clustered at the same time of day, verifications closing within five seconds, or an unbroken verified record over more than fourteen logs. Thirty points were subtracted from the total below before the band was decided, so this farm may sit in the intervention band for a reason that has nothing to do with needing help.',
  },
  flagged: {
    role: 'alert',
    title: 'One anti-gaming signal fired on this farm.',
    body:
      'One of three signals fired, which is below the threshold for a suspicion penalty — nothing has been subtracted from the score. It is a reason to look, not a finding.',
  },
  insufficient_data: {
    role: 'status',
    title: 'This farm has not been scored.',
    body:
      'The six pillars sum to less than seven raw points, or no score row was found at all. The server answers both with a complete zero row — total 0, band "intervention", every pillar 0 — so the figures would be an arithmetic artefact rather than a reading, and they are not drawn.',
  },
};

/**
 * The one predicate that decides whether Band 2 draws a number.
 *
 * A function rather than an inline comparison because it is the single place
 * the "do not draw a fabricated score" rule lives, and a test can break it.
 */
export function scoreIsReadable(score: FarmerHealthScoreBreakdownDto | null | undefined): boolean {
  return !!score && score.flag !== 'insufficient_data';
}

/** Σ pillars — what the six bars actually add to, before the subtraction. */
export function pillarSum(score: FarmerHealthScoreBreakdownDto): number {
  const p = score.pillars;
  return p.triggerFit + p.actionSimplicity + p.proof + p.reward + p.investment + p.repeat;
}

/* ══════════════════════════════════════════════════════ the ops:read gate ═ */

/**
 * The two blocks of Band 5, each with the module key the SERVER gates it on.
 *
 * 🛑 DO NOT COLLAPSE THESE INTO ONE KEY. They are two grants and the server
 * evaluates them independently; a single gate is wrong for anyone holding one
 * and not the other, and the wrong-way-round case renders a nulled block as
 * though it were a measured empty (property 1).
 */
export const OPS_BLOCKS = {
  sync: { module: ModuleKeys.OpsErrors, label: 'Sync state' },
  ai: { module: ModuleKeys.OpsVoice, label: 'AI health' },
} as const;

/**
 * 🛑 VERBATIM. The only honest partial-denial copy in the console, preserved
 * byte for byte from `FarmerHealthDrilldown.tsx:165` and asserted
 * character-for-character in `__tests__/FarmerHealthDrilldown.test.tsx`.
 *
 * It is the BOTH-denied sentence, which is also the scope-still-loading
 * sentence: `canRead` returns false until the scope resolves
 * (`useAdminScope.ts:86`), and that is deliberate rather than incidental —
 * treating "still loading" as access would render server-redacted nulls as
 * data for the width of a request.
 */
export const OPS_DENIED_BOTH =
  'Sync posture and AI invocation health for this farm exist but are not visible at your role.';

/**
 * One block denied, the other granted. The verbatim sentence names BOTH, so it
 * may not be used here — claiming a block is hidden while it is rendered three
 * inches below is the same class of untrue sentence this port exists to delete.
 */
export const OPS_DENIED_SYNC =
  'Sync posture for this farm exists but is not visible at your role. AI invocation health is shown below.';
export const OPS_DENIED_AI =
  'AI invocation health for this farm exists but is not visible at your role. Sync posture is shown above.';

/* ═══════════════════════════════════════════════════ sync and ai honesty ═ */

/**
 * WHY "PENDING PUSHES" IS NOT A NUMBER. Rendered, not merely commented — the
 * repository's own reason, in an operator's words.
 */
export const PENDING_PUSHES_WHY =
  'The server cannot see a device-side queue. This figure is hard-coded to 0 in the repository, so it is a constant rather than a reading.';

/** What `lastSyncAt` is really the maximum of — `sync.completed` OR
 *  `log.created` (`AdminFarmerHealthRepository.cs:335-338`). A log written on
 *  the device and never pushed still moves it. */
export const LAST_SYNC_WHY =
  'The most recent sync.completed OR log.created event, whichever is newer — a log written on the device moves this even when nothing was pushed.';

/** `failedPushesLast7d` counts `api.error` and `client.error`, the same two
 *  event types the timeline's Errors row and the table below it count. */
export const FAILED_PUSHES_WHY =
  'Every api.error and client.error event in seven days, not only push failures — the same events listed below and counted on the timeline.';

/**
 * A RATE OF 100% IS WHAT NO MEASUREMENT LOOKS LIKE (property 4).
 *
 * Both ratios COALESCE to `1.0` on a zero denominator and the whole block
 * falls back to `(1, 1, 0)` from a `catch`. With no invocations in the window
 * there is nothing to take a ratio of, so neither rate is a reading.
 */
export function aiRatesAreReadings(health: FarmerHealthAiHealthDto | null | undefined): boolean {
  return !!health && health.invocationCount14d > 0;
}

/** The server sends up to ten error rows and the panel shows five
 *  (`AdminFarmerHealthRepository.cs:361`). Five of ten, silently, is a list
 *  pretending to be a set. */
export const SYNC_ERRORS_SHOWN = 5;

export function syncErrorsWithheld(state: FarmerHealthSyncStateDto | null | undefined): number {
  return Math.max(0, (state?.lastErrors?.length ?? 0) - SYNC_ERRORS_SHOWN);
}

/* ═════════════════════════════════════════════════════════ the red line ═ */

/**
 * 🛑 VERBATIM MANDATORY COPY (A35). Do not reword it, do not soften it, and do
 * not move it into a tooltip. Asserted character-for-character in
 * `__tests__/FarmerHealthDrilldown.test.tsx`.
 *
 * It lives in this module rather than beside the component for the reason
 * `honestState.ts` gives about `INTERVENTION_EMPTY`: a string exported from a
 * component file trips `react-refresh/only-export-components`, and a lint
 * warning bought to save an import is a bad trade. One source, read by the
 * component AND by the test, so the assertion cannot pass against a copy
 * nothing renders.
 */
export const WORKER_DISCLAIMER =
  '(captured automatically from voice logs; reputation tracking not yet built)';

/** The server's own cap — `ORDER BY assignment_count DESC LIMIT 5`
 *  (`AdminFarmerHealthRepository.cs:296-303`). Five is a TOP FIVE, not a
 *  roster; a sixth row arriving would mean the query changed. */
export const WORKER_LIMIT = 5;

/* ══════════════════════════════════════════════════════════ the identity ═ */

/**
 * A NAME THAT IS ONLY PUNCTUATION IS NOT A NAME.
 *
 * `GetFarmIdentityAsync` answers its own `catch` with
 * `FarmIdentity(FarmerName: "—", Phone: "—")` and COALESCEs a missing phone to
 * the same em dash (`AdminFarmerHealthRepository.cs:135-160`). So the string
 * `—` arrives as a VALUE, and `PersonName` would render it as a Latin name —
 * visually identical to this console's missing-value dash but without the word
 * underneath saying which of the four causes it is.
 *
 * Normalised to `undefined` so the honest components handle it: the title
 * falls back to the farm id, and a cell reaches `NotMeasured`.
 *
 * What is NOT normalised: `COALESCE(u.display_name, f.name)` means a farm with
 * no owner membership sends the FARM's name in the farmer's field. That is a
 * real string and this client cannot tell it from a person's name, so it is
 * rendered as sent rather than guessed at.
 */
export function realName(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  /* Only dashes, em dashes and whitespace — never a name. `‐-―` is
     the Unicode dash block the server's `—` sits in; `-` is the ASCII
     hyphen. Written as escapes so the rule survives a file re-encoding. */
  return /^[\s\u002D\u2010-\u2015]+$/.test(trimmed) ? undefined : trimmed;
}
