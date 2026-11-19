/**
 * The 73 Company MIS items AS THE PLAN STATES THEM — an independent copy kept by
 * the test-writer, so tests compare the product's registry against the plan and
 * not against itself.
 *
 * Source: CR-2b plan "The 73 items" table, amended by B1-B4 (day values,
 * previous curve, five bands, the producer-organisation share), then CR-2c
 * (nine small additions served with the answer additions' fields; the three
 * district items keep their kind with the blocker sentences of Task 2 Step 3;
 * E9 counts 47 served / 3 small-addition / 23 outside-source, 6 reason codes).
 * `fields` is every answer field the plan lets that item print (the plan table
 * plus the amendments), the set a page may draw digits from inside that item.
 * `why` is the reason sentence the plan says is shown verbatim (null = served).
 */

export type PlanKind = 'S' | 'A' | 'O';
export type PlanSection = 'overview' | 'acquisition' | 'engagement' | 'retention' | 'quality' | 'farms' | 'operations';

export interface PlanItem {
  n: number;
  section: PlanSection;
  kind: PlanKind;
  fields: string[];
  why: string | null;
}

export const S_INSTALLS = 'Only Google Play knows how many people installed the app, and that report is not connected.';
export const S_INSTALLS_SHORT = 'Only Google Play knows installs.';
export const S_CHANNEL = 'The app does not send where an install came from.';
export const S_INSTALL_DISTRICT = 'The app does not record where an install happened.';
export const S_CRASH = 'No crash record reaches the server.';
/* CR-2c Task 2 Step 3: #40 and #62's district clause, then #58. */
export const S_DISTRICT = 'Most farms have no PIN code recorded, and the public PIN-to-district list is not added.';
export const S_FARM_DISTRICT = 'Most farms have no PIN code, taluka is not asked for, and the PIN-to-district list is missing.'; // E13(2)
export const S_SMS = "The SMS provider's delivery reports are not connected.";
export const S_SUPPORT = 'There is no support tool yet.';
export const S_OPS_HEADLINE =
  "Nothing on this page is measured yet: the SMS provider's delivery reports are not connected and there is no support tool yet.";

const ov = 'overview' as const;
const aq = 'acquisition' as const;
const en = 'engagement' as const;
const re = 'retention' as const;
const qu = 'quality' as const;
const fa = 'farms' as const;
const op = 'operations' as const;

export const PLAN_ITEMS: readonly PlanItem[] = [
  { n: 1, section: ov, kind: 'S', fields: ['overview.activeFarms', 'farms.farmsRegistered', 'farms.acresCovered'], why: null },
  { n: 2, section: ov, kind: 'O', fields: [], why: S_INSTALLS },
  { n: 3, section: ov, kind: 'S', fields: ['overview.signUps', 'overview.signUpsByDay'], why: null },
  { n: 4, section: ov, kind: 'S', fields: ['overview.dau', 'overview.activePeopleByDay'], why: null },
  { n: 5, section: ov, kind: 'S', fields: ['overview.wau'], why: null },
  { n: 6, section: ov, kind: 'S', fields: ['overview.mau'], why: null },
  { n: 7, section: ov, kind: 'S', fields: ['overview.stickinessPct'], why: null },
  { n: 8, section: ov, kind: 'S', fields: ['overview.logsRecorded'], why: null },
  // B18 V6: the voice tile's hint names {voiceLogs} of {logsRecorded} entries.
  { n: 9, section: ov, kind: 'S', fields: ['overview.voiceSharePct', 'overview.voiceLogs', 'overview.logsRecorded'], why: null },
  // CR-2c 1b: the median and the farm-days it rests on.
  { n: 10, section: ov, kind: 'S', fields: ['overview.understandingMedian', 'overview.understandingScoredDays'], why: null },
  { n: 11, section: ov, kind: 'O', fields: [], why: S_CRASH },
  { n: 12, section: ov, kind: 'O', fields: ['overview.signUpsByDay'], why: S_INSTALLS_SHORT },
  { n: 13, section: ov, kind: 'S', fields: ['overview.logsByWeek'], why: null },
  { n: 14, section: ov, kind: 'S', fields: ['overview.activeFarms', 'overview.voiceSharePct', 'overview.logsRecorded'], why: null },
  { n: 15, section: aq, kind: 'O', fields: [], why: S_INSTALLS },
  { n: 16, section: aq, kind: 'S', fields: ['acquisition.verified'], why: null },
  { n: 17, section: aq, kind: 'S', fields: ['acquisition.hasFarm'], why: null },
  { n: 18, section: aq, kind: 'S', fields: ['acquisition.firstLog'], why: null },
  { n: 19, section: aq, kind: 'S', fields: ['acquisition.habit', 'acquisition.habitEligible'], why: null },
  { n: 20, section: aq, kind: 'O', fields: [], why: S_INSTALLS_SHORT },
  { n: 21, section: aq, kind: 'O', fields: [], why: S_CHANNEL },
  { n: 22, section: aq, kind: 'O', fields: [], why: S_CHANNEL },
  { n: 23, section: aq, kind: 'O', fields: [], why: S_CHANNEL },
  { n: 24, section: aq, kind: 'O', fields: [], why: S_INSTALL_DISTRICT },
  { n: 25, section: aq, kind: 'O', fields: ['acquisition.verified', 'acquisition.habit', 'acquisition.habitEligible'], why: 'Installs and channels are not measured yet.' },
  { n: 26, section: en, kind: 'S', fields: ['engagement.logsByKind'], why: null },
  { n: 27, section: en, kind: 'S', fields: ['engagement.logsPerActiveFarmPerWeek'], why: null },
  { n: 28, section: en, kind: 'S', fields: ['engagement.whenLogged', 'engagement.whenLoggedClock'], why: null },
  { n: 29, section: en, kind: 'S', fields: ['engagement.featureUse'], why: null },
  { n: 30, section: en, kind: 'S', fields: ['engagement.roleMixOfMau'], why: null },
  { n: 31, section: en, kind: 'S', fields: ['engagement.featureUseByRole'], why: null },
  { n: 32, section: en, kind: 'S', fields: ['engagement.logsPerActiveFarmPerWeek', 'engagement.whenLogged'], why: null },
  { n: 33, section: re, kind: 'S', fields: ['retention.d1Pct'], why: null },
  { n: 34, section: re, kind: 'S', fields: ['retention.d30Pct'], why: null },
  { n: 35, section: re, kind: 'S', fields: ['retention.quietFarms7To29', 'retention.winBackByDay'], why: null },
  { n: 36, section: re, kind: 'S', fields: ['retention.silentFarms30Plus'], why: null },
  { n: 37, section: re, kind: 'S', fields: ['retention.cohortByWeek'], why: null },
  { n: 38, section: re, kind: 'S', fields: ['retention.curve', 'retention.previousCurve'], why: null },
  {
    n: 39, section: re, kind: 'S',
    fields: ['retention.activeFarms0To6', 'retention.quietFarms7To13', 'retention.quietFarms14To29', 'retention.quietFarms7To29', 'retention.silentFarms30Plus', 'retention.neverLoggedFarms'],
    why: null,
  },
  { n: 40, section: re, kind: 'A', fields: [], why: S_DISTRICT },
  { n: 41, section: re, kind: 'S', fields: ['retention.winBackByDay', 'retention.quietFarms7To29'], why: null },
  { n: 42, section: re, kind: 'S', fields: ['retention.d1Pct', 'retention.d30Pct', 'retention.quietFarms7To29'], why: null },
  { n: 43, section: qu, kind: 'S', fields: ['quality.voiceRecordingsSavedPct', 'quality.voiceRecordings'], why: null },
  // B3: items 44 and 45 are the two lines of one card.
  { n: 44, section: qu, kind: 'S', fields: ['quality.transcriptionAvgMs', 'quality.transcriptionP95Ms'], why: null },
  { n: 45, section: qu, kind: 'S', fields: ['quality.transcriptionP95Ms', 'quality.transcriptionAvgMs'], why: null },
  { n: 46, section: qu, kind: 'S', fields: ['quality.logsCorrectedPct', 'quality.logsCorrected'], why: null },
  // CR-2c 1c with E2/E10: the share, and two plain counts, "N sends refused" and "M changes accepted".
  { n: 47, section: qu, kind: 'S', fields: ['quality.syncRefusedPct', 'quality.syncRefusedChanges', 'quality.syncAcceptedChanges'], why: null },
  { n: 48, section: qu, kind: 'O', fields: [], why: S_CRASH },
  { n: 49, section: qu, kind: 'S', fields: ['quality.understandingSpread'], why: null },
  // CR-2c E8: no syncByDay; the chart reads the day lists of the two counts.
  { n: 50, section: qu, kind: 'S', fields: ['quality.syncRefusedChanges', 'quality.syncAcceptedChanges'], why: null },
  { n: 51, section: qu, kind: 'O', fields: [], why: S_CRASH },
  { n: 52, section: qu, kind: 'S', fields: ['quality.appVersions', 'quality.appVersionsSeenSince'], why: null },
  { n: 53, section: qu, kind: 'S', fields: ['quality.voiceRecordingsSavedPct', 'quality.logsCorrectedPct'], why: null },
  { n: 54, section: fa, kind: 'S', fields: ['farms.activeFarms'], why: null },
  { n: 55, section: fa, kind: 'S', fields: ['farms.farmsRegistered'], why: null },
  { n: 56, section: fa, kind: 'S', fields: ['farms.acresCovered'], why: null },
  { n: 57, section: fa, kind: 'S', fields: ['farms.activeFarmsInFpoPct', 'farms.farmsInFpo'], why: null },
  { n: 58, section: fa, kind: 'A', fields: [], why: S_FARM_DISTRICT },
  { n: 59, section: fa, kind: 'S', fields: ['farms.cropsOnActiveFarms'], why: null },
  { n: 60, section: fa, kind: 'S', fields: ['farms.farmsPerFpo'], why: null },
  { n: 61, section: fa, kind: 'S', fields: ['farms.acresByWeek'], why: null },
  { n: 62, section: fa, kind: 'A', fields: ['farms.activeFarms', 'farms.acresCovered'], why: S_DISTRICT },
  { n: 63, section: op, kind: 'O', fields: [], why: S_SMS },
  { n: 64, section: op, kind: 'O', fields: [], why: S_SMS },
  { n: 65, section: op, kind: 'O', fields: [], why: S_SMS },
  { n: 66, section: op, kind: 'O', fields: [], why: S_SMS },
  { n: 67, section: op, kind: 'O', fields: [], why: S_SUPPORT },
  { n: 68, section: op, kind: 'O', fields: [], why: S_SUPPORT },
  { n: 69, section: op, kind: 'O', fields: [], why: S_SUPPORT },
  { n: 70, section: op, kind: 'O', fields: [], why: S_SUPPORT },
  { n: 71, section: op, kind: 'O', fields: [], why: S_SUPPORT },
  { n: 72, section: op, kind: 'O', fields: [], why: S_SUPPORT },
  { n: 73, section: op, kind: 'O', fields: [], why: S_OPS_HEADLINE },
];

/** Headline items and the one chart item that print served numbers although their kind is A or O. */
export const PRINTS_SERVED_NUMBERS = new Set([12, 25, 62]);

export function planItem(n: number): PlanItem {
  const it = PLAN_ITEMS[n - 1];
  if (!it || it.n !== n) throw new Error(`plan item ${n} missing`);
  return it;
}

/** The reason sentences of the plan's "Reason sentences" table. */
export const PLAN_REASONS: Record<string, string> = {
  denominator_zero: 'There was nothing to divide by in this period, so a share cannot be worked out.',
  no_complete_window: 'Not enough days have passed since these people signed up to count this.',
  farm_list_unreadable: 'The server could not read the list of farms, so farm numbers were not counted. This is not a zero.',
  no_samples: 'No voice recording in this period finished with a time to average.',
  // CR-2c: the code a feature that writes no record carries (Compare).
  not_recorded: 'This is not recorded anywhere yet.',
  too_many_farms_for_live_count: 'There are now more than 500 farms, too many to count while the page loads. A nightly count is needed.',
};
export const PLAN_UNKNOWN_REASON = 'The server gave a reason this page does not know yet.';

export const PAGE_NAMES: Record<PlanSection, string> = {
  overview: 'Overview',
  acquisition: 'Acquisition',
  engagement: 'Engagement',
  retention: 'Retention',
  quality: 'Quality',
  farms: 'Farms & geography',
  operations: 'Operations',
};
