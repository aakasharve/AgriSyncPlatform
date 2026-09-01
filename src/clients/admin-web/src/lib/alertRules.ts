/**
 * R9 AND R10 — ONE DECLARATION, READ BY BOTH SCREENS THAT SHOW THEM.
 *
 * ── Why this file exists, and it is not tidiness ──────────────────────────
 * Task 20 established what these two rules actually are, from the SQL that
 * defines them (`20260502000000_AnalyticsRewrite.cs:424-456`), against a v3
 * prototype whose numbers were fiction — `data.js` says R9 breaches at 50 in
 * 24 hours and R10 under 96%; neither figure exists anywhere in this platform.
 *
 * Task 26 then needed the SAME two rules on Home: to count breaches on the
 * Active Alerts tile, and to take the Voice Success tile's tone from R10
 * rather than from the figure's own field. A second copy of "more than 30 API
 * errors in 1 hour" on a second screen is not a duplicated string — it is a
 * second statement of one fact about the database, and the console has already
 * been bitten once by exactly that shape (`nav.ts`: two destination lists that
 * had already drifted, one of them false).
 *
 * Two call sites is normally below the Rule of Three. It does not apply when
 * the two copies must AGREE for the console to be truthful: Home paints a tile
 * amber because R10 is breached, and Live Health explains R10. If those two
 * ever describe different thresholds, one of the screens is lying and no test
 * that reads only one of them can tell.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────
 * R1–R8. Eight detector views exist and `AlertDispatcherJob` reads all ten
 * once a day, but `/shramsafal/admin/ops/health` reads TWO — so the frontend
 * has no state for the other eight and must say NOT CHECKED rather than CLEAR
 * (Preservation Register D8). Live Health renders that as one synthetic row
 * with its own explanation; Home counts it as unchecked. Neither invents a
 * verdict, and neither is given a place here to start.
 *
 * This module is pure data plus one pure function: no React, no axios, no
 * component. It is imported by a screen and by a tile, and it must stay cheap
 * enough that importing it never drags anything else into a chunk.
 */

/**
 * BREACH / CLEAR / N/A / NOT CHECKED — four states, and the last two are not
 * shades of CLEAR.
 *
 *   `breach`      the view says true.
 *   `clear`       the view says false.
 *   `unread`      the endpoint sent `null`: it could not read the view at all
 *                 (`AdminOpsRepository.GetAlertBreachesAsync` swallows the
 *                 read and returns null when the matview is missing).
 *   `not-checked` this endpoint never reads the rule. R1–R8 only.
 */
export type RuleState = 'breach' | 'clear' | 'unread' | 'not-checked';

export const RULE_WORD: Record<RuleState, string> = {
  breach: 'BREACH',
  clear: 'CLEAR',
  unread: 'N/A',
  'not-checked': 'NOT CHECKED',
};

/**
 * `null` and `undefined` are BOTH unread, and deliberately not separated.
 *
 * `null` is the value the endpoint sends when it could not read the view;
 * `undefined` is what a caller holds before any response has arrived. A screen
 * that told those two apart would be reporting on its own request rather than
 * on the rule, and the honest word for both is the same: this reader does not
 * know. What it must never be is `false`.
 */
export function ruleStateOf(breached: boolean | null | undefined): RuleState {
  if (breached === true) return 'breach';
  if (breached === false) return 'clear';
  return 'unread';
}

export interface AlertRuleDefinition {
  id: 'R9' | 'R10';
  name: string;
  /** The rule in the words of the SQL that defines it. Not the prototype's. */
  rule: string;
  /** The matview the verdict is read from, named because a reader who wants to
   *  check the number needs somewhere to look. */
  view: string;
}

/**
 * R9 — `20260502000000_AnalyticsRewrite.cs:424`. `COUNT(*) > 30` over
 * `event_type = 'api.error'` in the trailing hour.
 */
export const R9: AlertRuleDefinition = {
  id: 'R9',
  name: 'API error spike',
  rule: 'more than 30 API errors in 1 hour',
  view: 'mis.alert_r9_api_error_spike',
};

/**
 * R10 — `20260502000000_AnalyticsRewrite.cs:441`.
 * `failures * 100.0 / NULLIF(COUNT(*),0) > 20` over the trailing SIX HOURS.
 *
 * 🛑 SIX HOURS IS THE WHOLE POINT ON HOME. `/ops/health` reports a voice
 * failure rate over TWENTY-FOUR hours. They are two different readings of two
 * different windows, so a 24-hour figure can sit either side of R10's line
 * without contradicting it. Live Health says so in as many words and paints no
 * verdict on the figure; Home may take its TONE from the rule — that is Task
 * 26 Step 4 — but it may not say that this figure breached that rule.
 */
export const R10: AlertRuleDefinition = {
  id: 'R10',
  name: 'Voice degraded',
  rule: 'voice failure rate above 20% in 6 hours',
  view: 'mis.alert_r10_voice_degraded',
};

/** The two rules `/shramsafal/admin/ops/health` reads, in the order both
 *  screens show them. */
export const RULES_READ_BY_OPS_HEALTH: AlertRuleDefinition[] = [R9, R10];

/**
 * The eight this endpoint does not read, as ONE entry rather than eight empty
 * rows. Their ids are real; their verdicts are not available here.
 */
export const RULES_NOT_CHECKED_BY_OPS_HEALTH = {
  id: 'R1–R8',
  name: 'Sync, engagement, correction and referral rules',
  rule: 'eight named rules with eight views of their own',
} as const;

/**
 * The verdict's provenance, in one line. A matview verdict has no age this
 * endpoint reports, so none is implied.
 */
export const FROM_A_NIGHTLY_VIEW =
  'read from a materialized view rebuilt once a day at 02:00 UTC — this feed does not report when';
