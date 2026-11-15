/**
 * THE 73 ITEMS OF THE SEVEN COMPANY MIS PAGES, and why each unserved one is
 * not measured.
 *
 * Every tile, card and chart on the pages carries `data-mis-item` with one of
 * these keys, and `data-mis-fields` with the answer fields it reads. A served
 * item prints only from those fields (or the arithmetic the plan states). An
 * item the server does not count says "Not measured yet" and its `why`, in
 * plain words, and prints no number.
 *
 * kinds: 'served' = counted by the company route; 'small-addition' = could be
 * counted from data already stored, not built yet; 'outside-source' = needs a
 * source outside the app (Google Play, the SMS provider, a support tool).
 */

export type MisSectionKey = 'overview' | 'acquisition' | 'engagement' | 'retention' | 'quality' | 'farms' | 'operations';

/** A dotted path into the company answer, e.g. 'overview.voiceSharePct'. */
export type MisFieldPath = string;

export interface MisItem {
  n: number;
  key: string;
  section: MisSectionKey;
  label: string;
  kind: 'served' | 'small-addition' | 'outside-source';
  fields: readonly MisFieldPath[];
  why: string | null;
  /** The short line under a tile's label, where the item is a tile. */
  hint?: string;
}

const INSTALLS = 'Only Google Play knows how many people installed the app, and that report is not connected.';
const INSTALLS_SHORT = 'Only Google Play knows installs.';
const CHANNEL = 'The app does not send where an install came from.';
const INSTALL_DISTRICT = 'The app does not record where an install happened.';
const UNDERSTANDING = "The daily understanding score is worked out when a farm's day is shown and is not kept, so it cannot be added up across farms yet.";
const CRASH = 'No crash record reaches the server.';
const LOG_TYPE = 'The kind of work in an entry is typed freely; there is no agreed list to sort it by yet.';
const FEATURE = 'Use of each feature is not brought together in one count yet, and Compare is not recorded at all.';
const QUIET_DISTRICT = 'Farms carry a PIN code but no district, and the PIN-to-district list is not added yet.';
const SYNC = 'Refused uploads are recorded but not turned into a rate yet, and retries on the phone are not recorded.';
const VERSION = 'App sessions are not recorded; the version each entry came from is stored but not counted yet.';
const FARM_DISTRICT = 'Farms carry a PIN code but no district, and taluka is not stored at all.';
const CROPS = "Crop names are typed freely, and there is no rule yet for a farm's main crop.";
const SMS = "The SMS provider's delivery reports are not connected.";
const SUPPORT = 'There is no support tool yet.';

export const MIS_ITEMS: readonly MisItem[] = [
  /* Overview, 14 */
  { n: 1, key: 'overview.activeFarms', section: 'overview', label: 'Active farms', kind: 'served', fields: ['overview.activeFarms', 'farms.farmsRegistered', 'farms.acresCovered'], why: null },
  { n: 2, key: 'overview.installs', section: 'overview', label: 'Installs', kind: 'outside-source', fields: [], why: INSTALLS, hint: 'From the Play Store' },
  { n: 3, key: 'overview.signUps', section: 'overview', label: 'Sign-ups', kind: 'served', fields: ['overview.signUps'], why: null, hint: 'Phone verified by OTP' },
  { n: 4, key: 'overview.dau', section: 'overview', label: 'Daily active people', kind: 'served', fields: ['overview.dau'], why: null, hint: 'People who saved an entry' },
  { n: 5, key: 'overview.wau', section: 'overview', label: 'Weekly active people', kind: 'served', fields: ['overview.wau'], why: null, hint: 'People who saved an entry' },
  { n: 6, key: 'overview.mau', section: 'overview', label: 'Monthly active people', kind: 'served', fields: ['overview.mau'], why: null, hint: 'People who saved an entry' },
  { n: 7, key: 'overview.stickiness', section: 'overview', label: 'Stickiness', kind: 'served', fields: ['overview.stickinessPct'], why: null, hint: 'Daily ÷ monthly active people' },
  { n: 8, key: 'overview.logsRecorded', section: 'overview', label: 'Entries saved', kind: 'served', fields: ['overview.logsRecorded'], why: null, hint: 'Every saved entry' },
  { n: 9, key: 'overview.voiceShare', section: 'overview', label: 'Saved by voice', kind: 'served', fields: ['overview.voiceSharePct', 'overview.voiceLogs'], why: null, hint: 'Only entries that came from a voice recording the app understood and checked.' },
  { n: 10, key: 'overview.understanding', section: 'overview', label: 'मला किती समजलं', kind: 'small-addition', fields: [], why: UNDERSTANDING, hint: 'Median understanding score' },
  { n: 11, key: 'overview.crashFree', section: 'overview', label: 'Crash-free sessions', kind: 'outside-source', fields: [], why: CRASH, hint: 'Sessions without a crash' },
  { n: 12, key: 'overview.installsAndSignUps', section: 'overview', label: 'Installs and sign-ups', kind: 'outside-source', fields: ['overview.signUpsByDay'], why: INSTALLS_SHORT },
  { n: 13, key: 'overview.logsByWeek', section: 'overview', label: 'Entries saved, voice and typed', kind: 'served', fields: ['overview.logsByWeek'], why: null },
  { n: 14, key: 'overview.headline', section: 'overview', label: 'Headline', kind: 'served', fields: ['overview.activeFarms', 'overview.voiceSharePct', 'overview.logsRecorded'], why: null },

  /* Acquisition, 11 */
  { n: 15, key: 'acquisition.installed', section: 'acquisition', label: 'Installed the app', kind: 'outside-source', fields: [], why: INSTALLS },
  { n: 16, key: 'acquisition.verified', section: 'acquisition', label: 'Verified phone by OTP', kind: 'served', fields: ['acquisition.verified'], why: null },
  { n: 17, key: 'acquisition.hasFarm', section: 'acquisition', label: 'Set up or joined a farm', kind: 'served', fields: ['acquisition.hasFarm'], why: null },
  { n: 18, key: 'acquisition.firstLog', section: 'acquisition', label: 'Saved a first entry', kind: 'served', fields: ['acquisition.firstLog'], why: null },
  { n: 19, key: 'acquisition.habit', section: 'acquisition', label: 'Saved entries on 3 of their first 7 days', kind: 'served', fields: ['acquisition.habit', 'acquisition.habitEligible'], why: null },
  { n: 20, key: 'acquisition.installsPerDay', section: 'acquisition', label: 'Installs per day', kind: 'outside-source', fields: [], why: INSTALLS_SHORT },
  { n: 21, key: 'acquisition.installsByChannel', section: 'acquisition', label: 'Installs by channel', kind: 'outside-source', fields: [], why: CHANNEL },
  { n: 22, key: 'acquisition.channelVerify', section: 'acquisition', label: 'Phone verified, by channel', kind: 'outside-source', fields: [], why: CHANNEL },
  { n: 23, key: 'acquisition.channelHabit', section: 'acquisition', label: 'Habit, by channel', kind: 'outside-source', fields: [], why: CHANNEL },
  { n: 24, key: 'acquisition.installsByDistrict', section: 'acquisition', label: 'Installs by district', kind: 'outside-source', fields: [], why: INSTALL_DISTRICT },
  { n: 25, key: 'acquisition.headline', section: 'acquisition', label: 'Headline', kind: 'outside-source', fields: ['acquisition.verified', 'acquisition.habit', 'acquisition.habitEligible'], why: 'Installs and channels are not measured yet.' },

  /* Engagement, 7 */
  { n: 26, key: 'engagement.logsByType', section: 'engagement', label: 'Entries by type', kind: 'small-addition', fields: [], why: LOG_TYPE },
  { n: 27, key: 'engagement.logsPerFarm', section: 'engagement', label: 'Entries per active farm, per week', kind: 'served', fields: ['engagement.logsPerActiveFarmPerWeek'], why: null },
  { n: 28, key: 'engagement.whenLogged', section: 'engagement', label: 'When farmers log', kind: 'served', fields: ['engagement.whenLogged', 'engagement.whenLoggedClock'], why: null },
  { n: 29, key: 'engagement.featureUse', section: 'engagement', label: 'Feature use', kind: 'small-addition', fields: [], why: FEATURE },
  { n: 30, key: 'engagement.roleMix', section: 'engagement', label: 'Monthly active people by role', kind: 'served', fields: ['engagement.roleMixOfMau'], why: null },
  { n: 31, key: 'engagement.featureByRole', section: 'engagement', label: 'Feature use by role', kind: 'small-addition', fields: [], why: FEATURE },
  { n: 32, key: 'engagement.headline', section: 'engagement', label: 'Headline', kind: 'served', fields: ['engagement.logsPerActiveFarmPerWeek', 'engagement.whenLogged'], why: null },

  /* Retention, 10 */
  { n: 33, key: 'retention.d1', section: 'retention', label: 'Came back next day', kind: 'served', fields: ['retention.d1Pct'], why: null, hint: 'Day-1 return, new sign-ups' },
  { n: 34, key: 'retention.d30', section: 'retention', label: 'Active on day 30', kind: 'served', fields: ['retention.d30Pct'], why: null, hint: 'Day-30 return, new sign-ups' },
  { n: 35, key: 'retention.quiet', section: 'retention', label: 'Silent 7–29 days', kind: 'served', fields: ['retention.quietFarms7To29'], why: null, hint: 'Farms that can still be won back' },
  { n: 36, key: 'retention.silent30', section: 'retention', label: 'Silent 30+ days', kind: 'served', fields: ['retention.silentFarms30Plus'], why: null, hint: 'Farms that have stopped' },
  { n: 37, key: 'retention.cohorts', section: 'retention', label: 'Return by sign-up week', kind: 'served', fields: ['retention.cohortByWeek'], why: null },
  { n: 38, key: 'retention.curve', section: 'retention', label: 'Return curve', kind: 'served', fields: ['retention.curve', 'retention.previousCurve'], why: null },
  { n: 39, key: 'retention.bands', section: 'retention', label: 'Where every registered farm stands', kind: 'served', fields: ['retention.activeFarms0To6', 'retention.quietFarms7To13', 'retention.quietFarms14To29', 'retention.silentFarms30Plus', 'retention.neverLoggedFarms'], why: null },
  { n: 40, key: 'retention.quietByDistrict', section: 'retention', label: 'Where farms are going quiet', kind: 'small-addition', fields: [], why: QUIET_DISTRICT },
  { n: 41, key: 'retention.winBack', section: 'retention', label: 'Farms that can still be won back', kind: 'served', fields: ['retention.winBackByDay', 'retention.quietFarms7To29'], why: null },
  { n: 42, key: 'retention.headline', section: 'retention', label: 'Headline', kind: 'served', fields: ['retention.d1Pct', 'retention.d30Pct', 'retention.quietFarms7To29'], why: null },

  /* Quality, 11 */
  { n: 43, key: 'quality.voiceSaved', section: 'quality', label: 'Voice recordings saved', kind: 'served', fields: ['quality.voiceRecordingsSavedPct', 'quality.voiceRecordings'], why: null, hint: 'Recordings that became a saved entry' },
  { n: 44, key: 'quality.transcriptionAvg', section: 'quality', label: 'Speech service time', kind: 'served', fields: ['quality.transcriptionAvgMs'], why: null, hint: 'Average' },
  { n: 45, key: 'quality.transcriptionP95', section: 'quality', label: 'Slowest 5%', kind: 'served', fields: ['quality.transcriptionP95Ms'], why: null, hint: '95th percentile' },
  { n: 46, key: 'quality.corrected', section: 'quality', label: 'Entries corrected', kind: 'served', fields: ['quality.logsCorrectedPct', 'quality.logsCorrected'], why: null, hint: 'Changed by the farmer after saving' },
  { n: 47, key: 'quality.syncFailTile', section: 'quality', label: 'Sync failures', kind: 'small-addition', fields: [], why: SYNC, hint: 'Uploads that had to retry' },
  { n: 48, key: 'quality.crashFree', section: 'quality', label: 'Crash-free sessions', kind: 'outside-source', fields: [], why: CRASH, hint: 'Sessions without a crash' },
  { n: 49, key: 'quality.scoreSpread', section: 'quality', label: 'मला किती समजलं, score spread', kind: 'small-addition', fields: [], why: UNDERSTANDING },
  { n: 50, key: 'quality.syncFailChart', section: 'quality', label: 'Sync failures', kind: 'small-addition', fields: [], why: SYNC },
  { n: 51, key: 'quality.crashByVersion', section: 'quality', label: 'Crashes by app version', kind: 'outside-source', fields: [], why: CRASH },
  { n: 52, key: 'quality.versionAdoption', section: 'quality', label: 'App version adoption', kind: 'small-addition', fields: [], why: VERSION },
  { n: 53, key: 'quality.headline', section: 'quality', label: 'Headline', kind: 'served', fields: ['quality.voiceRecordingsSavedPct', 'quality.logsCorrectedPct'], why: null },

  /* Farms & geography, 9 */
  { n: 54, key: 'farms.activeFarms', section: 'farms', label: 'Active farms', kind: 'served', fields: ['farms.activeFarms'], why: null, hint: 'Saved an entry in the last 7 days' },
  { n: 55, key: 'farms.registered', section: 'farms', label: 'Farms registered', kind: 'served', fields: ['farms.farmsRegistered'], why: null, hint: 'All farms set up by the last day' },
  { n: 56, key: 'farms.acres', section: 'farms', label: 'Acres covered', kind: 'served', fields: ['farms.acresCovered'], why: null, hint: 'Land under active farms' },
  { n: 57, key: 'farms.inFpo', section: 'farms', label: 'Farms in a producer organisation', kind: 'served', fields: ['farms.activeFarmsInFpoPct', 'farms.farmsInFpo'], why: null, hint: 'Of active farms' },
  { n: 58, key: 'farms.byDistrict', section: 'farms', label: 'Active farms by district', kind: 'small-addition', fields: [], why: FARM_DISTRICT },
  { n: 59, key: 'farms.crops', section: 'farms', label: 'Crops on active farms', kind: 'small-addition', fields: [], why: CROPS },
  { n: 60, key: 'farms.perFpo', section: 'farms', label: 'Farms per producer organisation', kind: 'served', fields: ['farms.farmsPerFpo'], why: null },
  { n: 61, key: 'farms.acresChart', section: 'farms', label: 'Acres covered', kind: 'served', fields: ['farms.acresByWeek'], why: null },
  { n: 62, key: 'farms.headline', section: 'farms', label: 'Headline', kind: 'small-addition', fields: ['farms.activeFarms', 'farms.acresCovered'], why: 'Districts are not measured yet.' },

  /* Operations, 11 */
  { n: 63, key: 'operations.otpDelivered', section: 'operations', label: 'OTP delivered', kind: 'outside-source', fields: [], why: SMS, hint: 'SMS codes that arrived' },
  { n: 64, key: 'operations.otpTime', section: 'operations', label: 'OTP arrival time', kind: 'outside-source', fields: [], why: SMS, hint: 'Average seconds to arrive' },
  { n: 65, key: 'operations.otpChart', section: 'operations', label: 'OTP texts delivered', kind: 'outside-source', fields: [], why: SMS },
  { n: 66, key: 'operations.otpFailReasons', section: 'operations', label: 'Why OTP texts failed', kind: 'outside-source', fields: [], why: SMS },
  { n: 67, key: 'operations.ticketsOpened', section: 'operations', label: 'Tickets opened', kind: 'outside-source', fields: [], why: SUPPORT, hint: 'New support requests' },
  { n: 68, key: 'operations.ticketsClosed', section: 'operations', label: 'Tickets closed', kind: 'outside-source', fields: [], why: SUPPORT, hint: 'Resolved in the range' },
  { n: 69, key: 'operations.ticketsOpen', section: 'operations', label: 'Open tickets', kind: 'outside-source', fields: [], why: SUPPORT, hint: 'Waiting on the last day' },
  { n: 70, key: 'operations.timeToClose', section: 'operations', label: 'Time to close', kind: 'outside-source', fields: [], why: SUPPORT, hint: 'Average hours per ticket' },
  { n: 71, key: 'operations.ticketsChart', section: 'operations', label: 'Support tickets opened and closed', kind: 'outside-source', fields: [], why: SUPPORT },
  { n: 72, key: 'operations.topIssues', section: 'operations', label: 'Top issues farmers raised', kind: 'outside-source', fields: [], why: SUPPORT },
  { n: 73, key: 'operations.headline', section: 'operations', label: 'Headline', kind: 'outside-source', fields: [], why: "Nothing on this page is measured yet: the SMS provider's delivery reports are not connected and there is no support tool yet." },
];

/** Parts of approved items that the route still does not serve (shown in words, never drawn). */
export const MIS_SLOTS: readonly { key: string; parent: string; why: string }[] = [
  {
    key: 'farms.perFpo.notInFpo',
    parent: 'farms.perFpo',
    why: 'Farms in no producer organisation are not listed: a farm can belong to two, so they cannot be worked out by subtracting.',
  },
];

/** Every answer field some served item reads. */
export const SERVED_FIELDS: readonly MisFieldPath[] = Array.from(
  new Set(MIS_ITEMS.flatMap((i) => i.fields)),
);

const REASONS: Record<string, string> = {
  denominator_zero: 'There was nothing to divide by in this period, so a share cannot be worked out.',
  no_complete_window: 'Not enough days have passed since these people signed up to count this.',
  farm_list_unreadable: 'The server could not read the list of farms, so farm numbers were not counted. This is not a zero.',
  no_samples: 'No voice recording in this period finished with a time to average.',
  too_many_farms_for_live_count: 'There are now more than 500 farms, too many to count while the page loads. A nightly count is needed.',
};

const UNKNOWN_REASON = 'The server gave a reason this page does not know yet.';

/**
 * B11: "nothing to divide by" said in the page's own terms, per item. The
 * generic `denominator_zero` sentence stays the fall-back for every other item.
 */
const NOTHING_TO_DIVIDE_BY: Record<string, string> = {
  'overview.voiceShare': 'No entry was saved in this period.',
  'quality.corrected': 'No entry was saved in this period.',
  'quality.voiceSaved': 'No voice recording was made in this period.',
  'overview.stickiness': 'Nobody saved an entry in the last 30 days.',
  'engagement.logsPerFarm': 'No farm was active in the last 7 days.',
  'farms.inFpo': 'No farm was active in the last 7 days.',
};

/**
 * The sentence shown after "Not measured:" for a server reason code. Unknown
 * codes fail closed.
 */
export function reasonSentence(code: string | null): string {
  if (code !== null && Object.prototype.hasOwnProperty.call(REASONS, code)) return REASONS[code];
  return UNKNOWN_REASON;
}

/** `reasonSentence` said for one item (B11); one argument would let `.map` pass an index here. */
export function reasonSentenceFor(code: string | null, itemKey: string | undefined): string {
  if (code === 'denominator_zero' && itemKey && Object.prototype.hasOwnProperty.call(NOTHING_TO_DIVIDE_BY, itemKey)) {
    return NOTHING_TO_DIVIDE_BY[itemKey];
  }
  return reasonSentence(code);
}

const BY_KEY = new Map(MIS_ITEMS.map((i) => [i.key, i]));

export function itemByKey(key: string): MisItem {
  const item = BY_KEY.get(key);
  if (!item) throw new Error(`Unknown MIS item: ${key}`);
  return item;
}

export function itemsOf(section: MisSectionKey): MisItem[] {
  return MIS_ITEMS.filter((i) => i.section === section);
}
