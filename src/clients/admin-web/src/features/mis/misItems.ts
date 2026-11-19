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
 * kinds: 'served' = counted by the company route; 'small-addition' = needs a
 * small addition, not built yet (after CR-2c only the three district items);
 * 'outside-source' = needs a source outside the app (Google Play, the SMS
 * provider, a support tool).
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
  /** B24: plain line, what the number is (visible on the page; verbatim from the reviewed lines file). */
  what: string;
  /** B24: plain line, why it is on the page. Named whyHere because `why` above is the not-measured reason. */
  whyHere: string;
}

const INSTALLS = 'Only Google Play knows how many people installed the app, and that report is not connected.';
const INSTALLS_SHORT = 'Only Google Play knows installs.';
const CHANNEL = 'The app does not send where an install came from.';
const INSTALL_DISTRICT = 'The app does not record where an install happened.';
const CRASH = 'No crash record reaches the server.';
/* CR-2c Step 3: the district items name what blocks them. */
const DISTRICT = 'Most farms have no PIN code recorded, and the public PIN-to-district list is not added.';
const FARM_DISTRICT = 'Most farms have no PIN code recorded, taluka is not asked for, and the PIN-to-district list is not added.';
const SMS = "The SMS provider's delivery reports are not connected.";
const SUPPORT = 'There is no support tool yet.';

export const MIS_ITEMS: readonly MisItem[] = [
  /* Overview, 14 */
  { n: 1, key: 'overview.activeFarms', section: 'overview', label: 'Active farms', kind: 'served', fields: ['overview.activeFarms', 'farms.farmsRegistered', 'farms.acresCovered'], why: null, what: "Farms that saved at least one entry in the 7 days ending on the last day chosen.", whyHere: "Shows how many farms really use the app each week, not just how many signed up." },
  { n: 2, key: 'overview.installs', section: 'overview', label: 'Installs', kind: 'outside-source', fields: [], why: INSTALLS, hint: 'From the Play Store', what: "People who installed the app from Google Play in the chosen days.", whyHere: "Shows how many people the marketing reaches before they ever sign up." },
  { n: 3, key: 'overview.signUps', section: 'overview', label: 'Sign-ups', kind: 'served', fields: ['overview.signUps'], why: null, hint: 'Phone verified by OTP', what: "People who verified their phone number with the SMS code in the chosen days.", whyHere: "Shows how many new people actually start using the app, day by day." },
  { n: 4, key: 'overview.dau', section: 'overview', label: 'Daily active people', kind: 'served', fields: ['overview.dau'], why: null, hint: 'People who saved an entry', what: "People who saved at least one entry on the last day chosen.", whyHere: "Shows for how many people the app is part of their working day." },
  { n: 5, key: 'overview.wau', section: 'overview', label: 'Weekly active people', kind: 'served', fields: ['overview.wau'], why: null, hint: 'People who saved an entry', what: "People who saved at least one entry in the last 7 days.", whyHere: "Shows the steady base of people using the app every week." },
  { n: 6, key: 'overview.mau', section: 'overview', label: 'Monthly active people', kind: 'served', fields: ['overview.mau'], why: null, hint: 'People who saved an entry', what: "People who saved at least one entry in the last 30 days.", whyHere: "Shows the widest group still using the app, the base for every habit figure." },
  { n: 7, key: 'overview.stickiness', section: 'overview', label: 'Stickiness', kind: 'served', fields: ['overview.stickinessPct'], why: null, hint: 'Daily ÷ monthly active people', what: "Daily active people as a share of monthly active people.", whyHere: "Shows whether people active in the month come back daily; higher means a real daily habit." },
  { n: 8, key: 'overview.logsRecorded', section: 'overview', label: 'Entries saved', kind: 'served', fields: ['overview.logsRecorded'], why: null, hint: 'Every saved entry', what: "Every diary entry saved on the server in the chosen days.", whyHere: "Shows the total work being recorded, the plainest sign the app is used." },
  { n: 9, key: 'overview.voiceShare', section: 'overview', label: 'Saved by voice', kind: 'served', fields: ['overview.voiceSharePct', 'overview.voiceLogs'], why: null, hint: 'Only entries that came from a voice recording the app understood and checked.', what: "Share of saved entries that came from a voice recording the app understood and checked.", whyHere: "Shows whether speaking, the app's main promise, is really how farmers record their work." },
  { n: 10, key: 'overview.understanding', section: 'overview', label: 'मला किती समजलं', kind: 'served', fields: ['overview.understandingMedian', 'overview.understandingScoredDays'], why: null, hint: 'Median understanding score', what: "The middle score, out of 10, across scored farm-days, including days scored 0 that the phone does not show.", whyHere: "Shows whether farmers' words are understood well enough to trust the record." },
  { n: 11, key: 'overview.crashFree', section: 'overview', label: 'Crash-free sessions', kind: 'outside-source', fields: [], why: CRASH, hint: 'Sessions without a crash', what: "Share of app openings that ended without the app crashing.", whyHere: "Shows whether the app is stable enough on farmers' phones to rely on." },
  { n: 12, key: 'overview.installsAndSignUps', section: 'overview', label: 'Installs and sign-ups', kind: 'outside-source', fields: ['overview.signUpsByDay'], why: INSTALLS_SHORT, what: "Installs and sign-ups for each day, drawn as two lines.", whyHere: "Shows how many installers go on to verify their phone, and on which days." },
  { n: 13, key: 'overview.logsByWeek', section: 'overview', label: 'Entries saved, voice and typed', kind: 'served', fields: ['overview.logsByWeek'], why: null, what: "Entries saved each week, split into voice entries and typed entries.", whyHere: "Shows whether voice use is growing or shrinking week by week." },
  { n: 14, key: 'overview.headline', section: 'overview', label: 'Headline', kind: 'served', fields: ['overview.activeFarms', 'overview.voiceSharePct', 'overview.logsRecorded'], why: null, what: "One sentence joining active farms, voice share and entries saved.", whyHere: "Gives the state of the company in one line before reading any tile." },

  /* Acquisition, 11 */
  { n: 15, key: 'acquisition.installed', section: 'acquisition', label: 'Installed the app', kind: 'outside-source', fields: [], why: INSTALLS, what: "People who installed the app, the first step before signing up.", whyHere: "Starting point for seeing how many installers become real users." },
  { n: 16, key: 'acquisition.verified', section: 'acquisition', label: 'Verified phone by OTP', kind: 'served', fields: ['acquisition.verified'], why: null, what: "People who verified their phone with the SMS code in the chosen days.", whyHere: "Second step: shows how many people who arrive actually sign up." },
  { n: 17, key: 'acquisition.hasFarm', section: 'acquisition', label: 'Set up or joined a farm', kind: 'served', fields: ['acquisition.hasFarm'], why: null, what: "Of those sign-ups, people who created a farm or joined someone's farm.", whyHere: "Shows whether new people get past setup, where many apps lose people." },
  { n: 18, key: 'acquisition.firstLog', section: 'acquisition', label: 'Saved a first entry', kind: 'served', fields: ['acquisition.firstLog'], why: null, what: "Of those sign-ups, people who saved at least one entry.", whyHere: "Shows whether new people do the one thing the app is for." },
  { n: 19, key: 'acquisition.habit', section: 'acquisition', label: 'Saved entries on 3 of their first 7 days', kind: 'served', fields: ['acquisition.habit', 'acquisition.habitEligible'], why: null, what: "Sign-ups old enough to judge who saved entries on 3 of their first 7 days.", whyHere: "Shows whether new people form a habit early, the best sign they will stay." },
  { n: 20, key: 'acquisition.installsPerDay', section: 'acquisition', label: 'Installs per day', kind: 'outside-source', fields: [], why: INSTALLS_SHORT, what: "Installs from Google Play counted for each day.", whyHere: "Shows which days campaigns or demos brought people in." },
  { n: 21, key: 'acquisition.installsByChannel', section: 'acquisition', label: 'Installs by channel', kind: 'outside-source', fields: [], why: CHANNEL, what: "Installs split by where they came from, such as Google Play search, WhatsApp, producer organisation or demo.", whyHere: "Shows which way of reaching farmers brings the most people, so effort goes there." },
  { n: 22, key: 'acquisition.channelVerify', section: 'acquisition', label: 'Phone verified, by channel', kind: 'outside-source', fields: [], why: CHANNEL, what: "For each source of installs, the share who verified their phone.", whyHere: "Shows which source brings people who actually sign up, not just install." },
  { n: 23, key: 'acquisition.channelHabit', section: 'acquisition', label: 'Habit, by channel', kind: 'outside-source', fields: [], why: CHANNEL, what: "For each source of installs, the share who saved entries on 3 of their first 7 days.", whyHere: "Shows which source brings farmers who keep using the app." },
  { n: 24, key: 'acquisition.installsByDistrict', section: 'acquisition', label: 'Installs by district', kind: 'outside-source', fields: [], why: INSTALL_DISTRICT, what: "Installs counted by the district where the phone was.", whyHere: "Shows where the app is spreading and where field effort is needed." },
  { n: 25, key: 'acquisition.headline', section: 'acquisition', label: 'Headline', kind: 'outside-source', fields: ['acquisition.verified', 'acquisition.habit', 'acquisition.habitEligible'], why: 'Installs and channels are not measured yet.', what: "One sentence joining sign-ups, the early habit share, installs and channels.", whyHere: "Gives the state of new-farmer growth in one line." },

  /* Engagement, 7 */
  { n: 26, key: 'engagement.logsByType', section: 'engagement', label: 'Entries by type', kind: 'served', fields: ['engagement.logsByKind'], why: null, what: "Saved entries by kind, as the app's own work-word list reads them; one entry can count twice.", whyHere: "Shows what farmers use the app for, and which kinds of work go unrecorded." },
  { n: 27, key: 'engagement.logsPerFarm', section: 'engagement', label: 'Entries per active farm, per week', kind: 'served', fields: ['engagement.logsPerActiveFarmPerWeek'], why: null, what: "Entries saved in the last 7 days divided by farms active in those 7 days.", whyHere: "Shows how deeply an active farm uses the app, not just whether it does." },
  { n: 28, key: 'engagement.whenLogged', section: 'engagement', label: 'When farmers log', kind: 'served', fields: ['engagement.whenLogged', 'engagement.whenLoggedClock'], why: null, what: "Entries by hour of day and day of week, India time, when they reached the server.", whyHere: "Shows when farmers work with the app, to time reminders, support and updates." },
  { n: 29, key: 'engagement.featureUse', section: 'engagement', label: 'Feature use', kind: 'served', fields: ['engagement.featureUse'], why: null, what: "Share of people who did anything counted here in this period who used each part; Compare is not recorded.", whyHere: "Shows which features earn their place and which nobody uses." },
  { n: 30, key: 'engagement.roleMix', section: 'engagement', label: 'Monthly active people by role', kind: 'served', fields: ['engagement.roleMixOfMau'], why: null, what: "People who saved an entry in the last 30 days, split by their role on the farm.", whyHere: "Shows whether only owners use the app, or their workers and supervisors too." },
  { n: 31, key: 'engagement.featureByRole', section: 'engagement', label: 'Feature use by role', kind: 'served', fields: ['engagement.featureUseByRole'], why: null, what: "People who used each part of the app, split by their role on the farm.", whyHere: "Shows which features matter to owners and which to workers or supervisors." },
  { n: 32, key: 'engagement.headline', section: 'engagement', label: 'Headline', kind: 'served', fields: ['engagement.logsPerActiveFarmPerWeek', 'engagement.whenLogged'], why: null, what: "One sentence joining entries per active farm and the busiest hour.", whyHere: "Gives in one line how deeply farms use the app." },

  /* Retention, 10 */
  { n: 33, key: 'retention.d1', section: 'retention', label: 'Came back next day', kind: 'served', fields: ['retention.d1Pct'], why: null, hint: 'Day-1 return, new sign-ups', what: "Share of new sign-ups who saved an entry on the day after they signed up.", whyHere: "Shows whether the first day convinced people to return." },
  { n: 34, key: 'retention.d30', section: 'retention', label: 'Active on day 30', kind: 'served', fields: ['retention.d30Pct'], why: null, hint: 'Day-30 return, new sign-ups', what: "Share of sign-ups who saved an entry on the thirtieth day after signing up.", whyHere: "Shows whether the app becomes a lasting habit, not a one-time try." },
  { n: 35, key: 'retention.quiet', section: 'retention', label: 'Silent 7–29 days', kind: 'served', fields: ['retention.quietFarms7To29'], why: null, hint: 'Farms that can still be won back', what: "Farms whose last entry was 7 to 29 days ago.", whyHere: "These farms can still be won back with a call; it sizes today's call list." },
  { n: 36, key: 'retention.silent30', section: 'retention', label: 'Silent 30+ days', kind: 'served', fields: ['retention.silentFarms30Plus'], why: null, hint: 'Farms that have stopped', what: "Farms whose last entry was 30 or more days ago.", whyHere: "Shows how many farms have stopped; a rising number means the app is losing farmers." },
  { n: 37, key: 'retention.cohorts', section: 'retention', label: 'Return by sign-up week', kind: 'served', fields: ['retention.cohortByWeek'], why: null, what: "For each week's sign-ups, the share who saved an entry on day 1, 7, 14 and 30.", whyHere: "Shows whether newer groups of farmers stay longer than older ones after each change." },
  { n: 38, key: 'retention.curve', section: 'retention', label: 'Return curve', kind: 'served', fields: ['retention.curve', 'retention.previousCurve'], why: null, what: "Share of sign-ups who saved an entry on each day after signing up, up to day 30.", whyHere: "Shows on which day people drop off, and whether that is getting better." },
  { n: 39, key: 'retention.bands', section: 'retention', label: 'Where every registered farm stands', kind: 'served', fields: ['retention.activeFarms0To6', 'retention.quietFarms7To13', 'retention.quietFarms14To29', 'retention.silentFarms30Plus', 'retention.neverLoggedFarms'], why: null, what: "Every registered farm placed by days since its last entry, including farms that never saved one.", whyHere: "Shows the whole farm base at a glance: active, going quiet, stopped, never started." },
  { n: 40, key: 'retention.quietByDistrict', section: 'retention', label: 'Where farms are going quiet', kind: 'small-addition', fields: [], why: DISTRICT, what: "Farms silent 7 to 29 days, counted by district.", whyHere: "Shows which areas need a field visit or a local partner's help." },
  { n: 41, key: 'retention.winBack', section: 'retention', label: 'Farms that can still be won back', kind: 'served', fields: ['retention.winBackByDay', 'retention.quietFarms7To29'], why: null, what: "Farms silent 7 to 29 days, counted for each day of the range.", whyHere: "Shows whether the call list is growing or shrinking over time." },
  { n: 42, key: 'retention.headline', section: 'retention', label: 'Headline', kind: 'served', fields: ['retention.d1Pct', 'retention.d30Pct', 'retention.quietFarms7To29'], why: null, what: "One sentence joining next-day return, day-30 return and farms going quiet.", whyHere: "Gives in one line whether farmers stay." },

  /* Quality, 11 */
  { n: 43, key: 'quality.voiceSaved', section: 'quality', label: 'Voice recordings saved', kind: 'served', fields: ['quality.voiceRecordingsSavedPct', 'quality.voiceRecordings'], why: null, hint: 'Recordings that became a saved entry', what: "Share of voice recordings that became a saved entry.", whyHere: "Shows whether speaking actually ends in a saved record or gets lost." },
  { n: 44, key: 'quality.transcriptionAvg', section: 'quality', label: 'Speech service time', kind: 'served', fields: ['quality.transcriptionAvgMs'], why: null, hint: 'Average', what: "Average time the speech service took to turn a recording into words.", whyHere: "Shows whether farmers are kept waiting after they speak." },
  { n: 45, key: 'quality.transcriptionP95', section: 'quality', label: 'Slowest 5%', kind: 'served', fields: ['quality.transcriptionP95Ms'], why: null, hint: '95th percentile', what: "The longest wait for 95 of every 100 recordings; only the slowest 5 waited longer.", whyHere: "Shows the worst waits farmers commonly face, which an average hides." },
  { n: 46, key: 'quality.corrected', section: 'quality', label: 'Entries corrected', kind: 'served', fields: ['quality.logsCorrectedPct', 'quality.logsCorrected'], why: null, hint: 'Changed by the farmer after saving', what: "Share of saved entries changed by the farmer after saving.", whyHere: "Shows how often the first saved record was wrong and needed fixing." },
  { n: 47, key: 'quality.syncFailTile', section: 'quality', label: 'Sync failures', kind: 'served', fields: ['quality.syncRefusedPct', 'quality.syncRefusedChanges', 'quality.syncAcceptedChanges'], why: null, hint: 'Changes from phones the server refused', what: "Of changes sent from phones, the share the server refused; a change refused again counts each time.", whyHere: "Shows whether farmers' entries reach the server reliably or get stuck on the phone." },
  { n: 48, key: 'quality.crashFree', section: 'quality', label: 'Crash-free sessions', kind: 'outside-source', fields: [], why: CRASH, hint: 'Sessions without a crash', what: "Share of app openings that ended without a crash.", whyHere: "Shows app stability, a top reason people give up on an app." },
  { n: 49, key: 'quality.scoreSpread', section: 'quality', label: 'मला किती समजलं, score spread', kind: 'served', fields: ['quality.understandingSpread'], why: null, what: "How farm days spread across understanding scores from 0 to 10.", whyHere: "Shows whether poor understanding is rare or common, beyond the middle score." },
  { n: 50, key: 'quality.syncFailChart', section: 'quality', label: 'Sync failures', kind: 'served', fields: ['quality.syncRefusedChanges', 'quality.syncAcceptedChanges'], why: null, what: "Changes from phones the server refused or accepted, day by day.", whyHere: "Shows when upload problems started, to link them to a release or outage." },
  { n: 51, key: 'quality.crashByVersion', section: 'quality', label: 'Crashes by app version', kind: 'outside-source', fields: [], why: CRASH, what: "Crashes counted for each version of the app.", whyHere: "Shows whether a new release made the app less stable." },
  { n: 52, key: 'quality.versionAdoption', section: 'quality', label: 'App version adoption', kind: 'served', fields: ['quality.appVersions', 'quality.appVersionsSeenSince'], why: null, what: "People seen in this period, each on the newest app version they used, phones and web apart.", whyHere: "Shows how many farmers still run an old version that lacks fixes." },
  { n: 53, key: 'quality.headline', section: 'quality', label: 'Headline', kind: 'served', fields: ['quality.voiceRecordingsSavedPct', 'quality.logsCorrectedPct'], why: null, what: "One sentence joining voice recordings saved and entries corrected.", whyHere: "Gives in one line whether voice recording works for farmers." },

  /* Farms & geography, 9 */
  { n: 54, key: 'farms.activeFarms', section: 'farms', label: 'Active farms', kind: 'served', fields: ['farms.activeFarms'], why: null, hint: 'Saved an entry in the last 7 days', what: "Farms that saved at least one entry in the last 7 days.", whyHere: "Shows the real size of the business: the farms that use it weekly." },
  { n: 55, key: 'farms.registered', section: 'farms', label: 'Farms registered', kind: 'served', fields: ['farms.farmsRegistered'], why: null, hint: 'All farms set up by the last day', what: "All farms set up in the app by the last day chosen.", whyHere: "Shows total reach; next to active farms it shows how many went unused." },
  { n: 56, key: 'farms.acres', section: 'farms', label: 'Acres covered', kind: 'served', fields: ['farms.acresCovered'], why: null, hint: 'Land under active farms', what: "Acres of plots on farms that saved an entry in the last 7 days.", whyHere: "Shows how much farmland the app really covers, a figure partners and funders ask for." },
  { n: 57, key: 'farms.inFpo', section: 'farms', label: 'Farms in a producer organisation', kind: 'served', fields: ['farms.activeFarmsInFpoPct', 'farms.farmsInFpo'], why: null, hint: 'Of active farms', what: "Share of active farms that belong to a farmer producer organisation.", whyHere: "Shows how much growth comes through producer organisations rather than one farmer at a time." },
  { n: 58, key: 'farms.byDistrict', section: 'farms', label: 'Active farms by district', kind: 'small-addition', fields: [], why: FARM_DISTRICT, what: "Active farms counted by district and taluka.", whyHere: "Shows where the app is used, to plan field teams and partners." },
  { n: 59, key: 'farms.crops', section: 'farms', label: 'Crops on active farms', kind: 'served', fields: ['farms.cropsOnActiveFarms'], why: null, what: "Crops on active farms by the name entered, with farms and plot acres; a plot can count twice.", whyHere: "Shows which crops the app serves, to shape schedules and partnerships." },
  { n: 60, key: 'farms.perFpo', section: 'farms', label: 'Farms per producer organisation', kind: 'served', fields: ['farms.farmsPerFpo'], why: null, what: "Farms counted under each farmer producer organisation.", whyHere: "Shows which organisations bring the most farms and which need support." },
  { n: 61, key: 'farms.acresChart', section: 'farms', label: 'Acres covered', kind: 'served', fields: ['farms.acresByWeek'], why: null, what: "Acres under active farms, measured each week across the range.", whyHere: "Shows whether the land covered is growing or shrinking." },
  { n: 62, key: 'farms.headline', section: 'farms', label: 'Headline', kind: 'small-addition', fields: ['farms.activeFarms', 'farms.acresCovered'], why: DISTRICT, what: "One sentence joining active farms, acres covered and the top district.", whyHere: "Gives the farm footprint in one line." },

  /* Operations, 11 */
  { n: 63, key: 'operations.otpDelivered', section: 'operations', label: 'OTP delivered', kind: 'outside-source', fields: [], why: SMS, hint: 'SMS codes that arrived', what: "Share of sign-in SMS codes that actually reached the phone.", whyHere: "Shows whether farmers can sign in at all; a code that never arrives loses a farmer." },
  { n: 64, key: 'operations.otpTime', section: 'operations', label: 'OTP arrival time', kind: 'outside-source', fields: [], why: SMS, hint: 'Average seconds to arrive', what: "Average seconds for a sign-in SMS code to reach the phone.", whyHere: "Shows whether farmers wait too long at sign-in and give up." },
  { n: 65, key: 'operations.otpChart', section: 'operations', label: 'OTP texts delivered', kind: 'outside-source', fields: [], why: SMS, what: "Sign-in SMS codes sent and delivered, day by day.", whyHere: "Shows when SMS delivery broke, to raise it with the SMS provider." },
  { n: 66, key: 'operations.otpFailReasons', section: 'operations', label: 'Why OTP texts failed', kind: 'outside-source', fields: [], why: SMS, what: "Sign-in SMS codes that failed, grouped by the reason the SMS provider gave.", whyHere: "Shows what to fix with the SMS provider, such as blocked numbers or network faults." },
  { n: 67, key: 'operations.ticketsOpened', section: 'operations', label: 'Tickets opened', kind: 'outside-source', fields: [], why: SUPPORT, hint: 'New support requests', what: "New help requests from farmers in the chosen days.", whyHere: "Shows how much trouble farmers run into." },
  { n: 68, key: 'operations.ticketsClosed', section: 'operations', label: 'Tickets closed', kind: 'outside-source', fields: [], why: SUPPORT, hint: 'Resolved in the range', what: "Help requests solved in the chosen days.", whyHere: "Shows whether the support team keeps up with requests." },
  { n: 69, key: 'operations.ticketsOpen', section: 'operations', label: 'Open tickets', kind: 'outside-source', fields: [], why: SUPPORT, hint: 'Waiting on the last day', what: "Help requests still waiting on the last day chosen.", whyHere: "Shows the backlog of farmers waiting for help." },
  { n: 70, key: 'operations.timeToClose', section: 'operations', label: 'Time to close', kind: 'outside-source', fields: [], why: SUPPORT, hint: 'Average hours per ticket', what: "Average hours from a help request to its solution.", whyHere: "Shows how long a stuck farmer waits for help." },
  { n: 71, key: 'operations.ticketsChart', section: 'operations', label: 'Support tickets opened and closed', kind: 'outside-source', fields: [], why: SUPPORT, what: "Help requests opened and closed, day by day.", whyHere: "Shows whether support is falling behind, and when." },
  { n: 72, key: 'operations.topIssues', section: 'operations', label: 'Top issues farmers raised', kind: 'outside-source', fields: [], why: SUPPORT, what: "The most common problems farmers raised in help requests.", whyHere: "Shows what to fix first in the app or in training." },
  { n: 73, key: 'operations.headline', section: 'operations', label: 'Headline', kind: 'outside-source', fields: [], why: "Nothing on this page is measured yet: the SMS provider's delivery reports are not connected and there is no support tool yet.", what: "One sentence on sign-in SMS delivery and farmer help requests.", whyHere: "Gives in one line whether farmers can sign in and get help." },
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
  not_recorded: 'This is not recorded anywhere yet.',
  too_many_farms_for_live_count: 'There are now more than 500 farms, too many to count while the page loads. A nightly count is needed.',
};

const UNKNOWN_REASON = 'The server gave a reason this page does not know yet.';

/**
 * B11: "nothing to divide by" said in the page's own terms, per item. The
 * generic `denominator_zero` sentence stays the fall-back for every other item.
 */
const NO_SCORED_DAY = 'No farm-day in this period got a score.';
const NO_CHANGE_SENT = 'No change was sent from a phone in this period.';

const NOTHING_TO_DIVIDE_BY: Record<string, string> = {
  'overview.voiceShare': 'No entry was saved in this period.',
  'quality.corrected': 'No entry was saved in this period.',
  'quality.voiceSaved': 'No voice recording was made in this period.',
  'overview.stickiness': 'Nobody saved an entry in the last 30 days.',
  'engagement.logsPerFarm': 'No farm was active in the last 7 days.',
  'farms.inFpo': 'No farm was active in the last 7 days.',
  /* CR-2c E7: sync says it in its own words for both codes. */
  'quality.syncFailTile': NO_CHANGE_SENT,
  'quality.syncFailChart': NO_CHANGE_SENT,
};

/**
 * CR-2c E7: the generic `no_samples` sentence speaks of voice recordings, so
 * the items whose samples are something else say what is missing.
 */
const NO_SAMPLES: Record<string, string> = {
  'overview.understanding': NO_SCORED_DAY,
  'quality.scoreSpread': NO_SCORED_DAY,
  'quality.syncFailTile': NO_CHANGE_SENT,
  'quality.syncFailChart': NO_CHANGE_SENT,
};

/**
 * The sentence shown after "Not measured:" for a server reason code. Unknown
 * codes fail closed.
 */
export function reasonSentence(code: string | null): string {
  if (code !== null && Object.prototype.hasOwnProperty.call(REASONS, code)) return REASONS[code];
  return UNKNOWN_REASON;
}

/** `reasonSentence` said for one item (B11, CR-2c E7); one argument would let `.map` pass an index here. */
export function reasonSentenceFor(code: string | null, itemKey: string | undefined): string {
  const own = code === 'denominator_zero' ? NOTHING_TO_DIVIDE_BY : code === 'no_samples' ? NO_SAMPLES : null;
  if (own && itemKey && Object.prototype.hasOwnProperty.call(own, itemKey)) return own[itemKey];
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
