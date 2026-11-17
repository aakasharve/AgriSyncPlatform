/**
 * THE TWO PLAIN LINES FOR EVERY OLDER-PAGE NUMBER (amendment B21/B24, 2026-11-17).
 *
 * Copied verbatim from the reviewed file metric-lines.json (every entry whose page does
 * not start with "MIS"). Nothing is reworded here.
 *
 * status:
 *   real    the number is counted today; the page shows it with these two lines.
 *   idea    the number is NOT built yet. The page shows "Not built yet" and these two lines,
 *           and no number, no zero, no dash, no chart (B24; founder's rule, B23).
 *   double  the same number is shown in another place that stays (`keeper`); the number is
 *           removed from its old page. Kept here so the removal can be checked.
 *
 * Company MIS items carry their lines in features/mis/misItems.ts.
 */

export type MetricLineStatus = 'real' | 'idea' | 'double';

export interface MetricLine {
  page: string;
  key: string;
  label: string;
  status: MetricLineStatus;
  buildId: string;
  /** Absent only on a double, which is not shown. */
  what?: string;
  why?: string;
  /** Where a double's number still lives. */
  keeper?: string;
}

export const METRIC_LINES: readonly MetricLine[] = [
  { page: "Live Health", key: "live-alert-rules", label: "Alert rules", status: "idea", buildId: "L1", what: "Two automatic checks: over 30 server errors in an hour, and voice failing over 20% in six hours.", why: "Raises a flag when something breaks for many farmers at once." },
  { page: "Live Health", key: "live-recent-events", label: "Recent events", status: "real", buildId: "L6", what: "Every server error, slow save and phone-reported problem in the last two hours.", why: "Shows what is breaking right now, before farmers call to complain." },
  { page: "Live Health", key: "live-service-health", label: "Feeds this console depends on", status: "real", buildId: "L8", what: "Whether each data source behind this screen answered, and when it was last heard.", why: "Tells you whether the numbers on the screen can be trusted right now." },
  { page: "API Errors", key: "errors-list", label: "API errors", status: "real", buildId: "E1", what: "Each server error, slow save and phone-reported problem, with its time, place and status.", why: "Lets you see exactly what failed and when, so it gets fixed." },
  { page: "API Errors", key: "errors-total", label: "Errors in the chosen window", status: "real", buildId: "E2", what: "Number of errors, slow saves and phone-reported problems in the chosen time window.", why: "Shows whether problems are rising or falling across hours and days." },
  { page: "API Errors", key: "errors-farm", label: "Farm", status: "real", buildId: "E3", what: "The farm each error belongs to, when the request named a farm.", why: "Shows which farmers were hit by a problem, so someone can call them." },
  { page: "WVFD", key: "wvfd-average", label: "Verified farm-days per farm", status: "idea", buildId: "W1", what: "Average days per farm in a week with an entry confirmed within 48 hours.", why: "Shows whether farms record confirmed work most days, the old main company target." },
  { page: "WVFD", key: "wvfd-change", label: "Change from the week before", status: "idea", buildId: "W2", what: "Change in that average from the week before.", why: "Shows whether confirmed daily use is improving or slipping." },
  { page: "WVFD", key: "wvfd-farms", label: "Farms with a row that week", status: "idea", buildId: "W3", what: "Farms that saved at least one entry in that week.", why: "Shows how many farms the weekly average is worked out over." },
  { page: "WVFD", key: "wvfd-tiers", label: "Tiers among the farms this feed returns", status: "idea", buildId: "W6", what: "Farms grouped A to D by how many confirmed days they had that week.", why: "Shows how many farms are steady users and how many barely use the app." },
  { page: "WVFD", key: "wvfd-farm-list", label: "Every farm's contribution", status: "idea", buildId: "W7", what: "Each farm's confirmed days that week, highest first.", why: "Shows which farms lead and which need attention." },
  { page: "All Farms", key: "farms-list", label: "All farms", status: "real", buildId: "F1", what: "Every farm with its name, the owner's phone and the date it was set up.", why: "Lets you find and call any farm directly." },
  { page: "All Farms", key: "farms-total", label: "Total farms", status: "real", buildId: "F2", what: "Number of farms set up in the app, with no activity filter.", why: "Shows how many farms you can reach from this list." },
  { page: "All Farms", key: "farms-last-log", label: "Last Log", status: "real", buildId: "F3", what: "When each farm's latest entry reached the server.", why: "Shows which farms have gone quiet, so someone can call them." },
  { page: "All Farms", key: "farms-tier", label: "Tier", status: "idea", buildId: "F4", what: "Each farm's A to D group by confirmed days last week.", why: "Lets you sort farms into steady, light and absent users." },
  { page: "All Farms", key: "farms-wvfd7d", label: "WVFD 7d", status: "idea", buildId: "F5", what: "Each farm's days with a confirmed entry last week.", why: "Shows how regularly each farm records its work." },
  { page: "All Farms", key: "farms-errors24h", label: "Errors 24h", status: "real", buildId: "F6", what: "Problems in the last 24 hours on requests that named this farm.", why: "Shows which farmers are struggling with the app today." },
  { page: "Suffering", key: "suffering-watchlist", label: "Farmer suffering watchlist", status: "real", buildId: "U1", what: "Farms with three or more problems in 7 days on requests that named the farm.", why: "Names the farmers most likely to give up, so someone helps them first." },
  { page: "Farmer Health drilldown", key: "fh-timeline", label: "14-day timeline (started, finished, proof, summary viewed)", status: "real", buildId: "P3", what: "For one farm, each day's day-closings started and finished, proof photos added and summaries viewed.", why: "Shows how one farm really uses the app, day by day, before you call." },
  { page: "Farmer Health drilldown", key: "fh-timeline-errors", label: "Errors", status: "idea", buildId: "P5", what: "For one farm, problems recorded on each of the last 14 days.", why: "Shows whether a farm went quiet after a run of failures." },
  { page: "Farmer Health drilldown", key: "fh-last-activity", label: "Last entry reached the server", status: "real", buildId: "P8", what: "When this farm's latest entry reached the server.", why: "Shows how long this farm has been quiet." },
  { page: "Users", key: "users-list", label: "Accounts", status: "real", buildId: "R1", what: "Every person with an account: phone, name and the date they joined.", why: "Lets you find any person and check their account." },
  { page: "Users", key: "users-total", label: "Total accounts", status: "real", buildId: "R2", what: "Number of accounts, test accounts included.", why: "Shows how many people have ever signed up, before test accounts are taken out." },
  { page: "Users", key: "users-last-signin", label: "Last sign-in", status: "real", buildId: "R3", what: "When each person last signed in, or the app last renewed their sign-in.", why: "Shows whether a person still opens the app, even without saving entries." },
  { page: "Schedule Templates", key: "templates-list", label: "Schedule templates", status: "real", buildId: "R4", what: "The ready-made crop schedules farmers can pick, with crop, tasks and timing.", why: "Shows which crops have a schedule ready and which still need one." },
  { page: "Home", key: "home-mrr", label: "Monthly revenue", status: "idea", buildId: "H8", what: "Money that paying farms bring in each month.", why: "Shows whether paying farms cover the cost of running ShramSafal each month." },
  { page: "Home", key: "home-call-list", label: "Farms a person should call today", status: "idea", buildId: "H9", what: "Farms gone quiet or hitting repeated problems, named with the owner's phone number.", why: "Gives the team a short list of farmers to call before they give up." },
  { page: "Live Health", key: "live-suffering-24h", label: "Farms with repeated problems, last 24 hours", status: "real", buildId: "L7", what: "Farms with two or more problems in the last day on requests that named the farm.", why: "Lets the team call a farmer the same day things go wrong." },
  { page: "WVFD", key: "wvfd-weeks", label: "Weeks with a row", status: "idea", buildId: "W4", what: "How many weeks in the chosen time have any confirmed farm-day counted.", why: "Tells you how much history the averages above are built on." },
  { page: "WVFD", key: "wvfd-goal", label: "Goal", status: "idea", buildId: "W5", what: "The weekly confirmed farm-days per farm the company aims for.", why: "A target turns the number into a plain yes or no for each week." },
  { page: "Silent Churn", key: "silent-watchlist", label: "Farms gone silent", status: "idea", buildId: "S1", what: "Farms with no entry for a week or more, with owner phone and last entry.", why: "Names the farms to call back before they stop using the app for good." },
  { page: "Silent Churn", key: "silent-plan", label: "Plan", status: "idea", buildId: "S2", what: "Whether the farm's owner is on the free plan, a trial or a paid plan.", why: "Helps decide who to call first when a paying farm goes quiet." },
  { page: "Silent Churn", key: "silent-groups", label: "By silence and by plan", status: "idea", buildId: "S3", what: "Counts of silent farms grouped by weeks silent and by plan.", why: "Shows at a glance whether quiet farms are new trials or paying farms." },
  { page: "Suffering", key: "suffering-areas", label: "Syncing, entries and voice columns", status: "real", buildId: "U2", what: "Splits each farm's problems into syncing, saving entries, voice recording and other.", why: "Tells the team which part of the app to look at before calling." },
  { page: "Farmer Health", key: "fh-queue", label: "Farms to help first", status: "idea", buildId: "FH1", what: "Farms whose health score dropped the most, with the score and last active day.", why: "Points the team to farms slipping before they go silent." },
  { page: "Farmer Health", key: "fh-distribution", label: "Score spread", status: "idea", buildId: "FH2", what: "How many farms fall in each band of the farm health score.", why: "Shows whether most farms are doing well or struggling overall." },
  { page: "Farmer Health", key: "fh-pillars", label: "Where farms lose points", status: "idea", buildId: "FH4", what: "Which of the six parts of the health score pulls farms down the most.", why: "Tells the product team what to improve first for most farms." },
  { page: "Farmer Health", key: "fh-cohort-avg", label: "Average score by week", status: "idea", buildId: "FH5", what: "The average farm health score across all farms, week by week.", why: "Shows whether farms are getting healthier over time or slipping." },
  { page: "Farmer Health drilldown", key: "fh-name-phone", label: "Farmer name and phone", status: "idea", buildId: "P1", what: "The farm owner's name and phone number.", why: "So the team can call the right person straight from this page." },
  { page: "Farmer Health drilldown", key: "fh-score", label: "Farm score and its six parts", status: "idea", buildId: "P2", what: "This farm's health score and the six parts it is made of.", why: "Shows what this one farm does well and where it needs help." },
  { page: "Farmer Health drilldown", key: "fh-timeline-verifies", label: "Checked", status: "idea", buildId: "P4", what: "Entries on this farm checked and confirmed by someone, day by day.", why: "Shows whether the farm's records are trusted, not only typed in." },
  { page: "Farmer Health drilldown", key: "fh-verification-counts", label: "Checks on entries", status: "idea", buildId: "P6", what: "Entries confirmed, verified, disputed and still waiting for a check on this farm.", why: "A pile of waiting or disputed entries is a reason to call." },
  { page: "Farmer Health drilldown", key: "fh-workers", label: "Workers", status: "idea", buildId: "P7", what: "The five workers named most often in this farm's entries.", why: "Shows who actually does the work, so a call can mention them." },
  { page: "Farmer Health drilldown", key: "fh-failed-uploads", label: "Refused uploads", status: "idea", buildId: "P9", what: "Times the server refused entries sent from this farm's phone in the last 7 days.", why: "Refused uploads mean the farmer's work may not have reached us." },
  { page: "Farmer Health drilldown", key: "fh-reading-rates", label: "Voice and photo reading", status: "idea", buildId: "P10", what: "Share of this farm's voice recordings and receipt photos read and saved successfully.", why: "If reading fails often, the farmer stops trusting voice and photos." },
  { page: "Farmer Health drilldown", key: "fh-reading-count", label: "Recordings and photos read", status: "idea", buildId: "P11", what: "How many voice recordings and photos from this farm were read in 14 days.", why: "Shows how much this farm relies on voice and photos to keep records." },
  { page: "Home", key: "home-active-alerts", label: "Active alerts", status: "double", buildId: "H1", keeper: "Live Health: Alert rules" },
  { page: "Home", key: "home-api-errors-2h", label: "API errors, last 2 hours", status: "double", buildId: "H2", keeper: "Live Health: Recent events" },
  { page: "Home", key: "home-ai-success", label: "AI call success, 24 h", status: "double", buildId: "H3", keeper: "Company MIS, Quality: Voice recordings saved" },
  { page: "Home", key: "home-logs-today", label: "Logs today", status: "double", buildId: "H4", keeper: "Company MIS, Overview: Entries saved (range set to today)" },
  { page: "Home", key: "home-wvfd", label: "WVFD", status: "double", buildId: "H5", keeper: "WVFD page: Verified farm-days per farm" },
  { page: "Home", key: "home-farms", label: "Farms on record", status: "double", buildId: "H6", keeper: "Company MIS, Farms: Farms registered" },
  { page: "Home", key: "home-d30", label: "D30 retention", status: "double", buildId: "H7", keeper: "Company MIS, Retention: Active on day 30" },
  { page: "Live Health", key: "live-ai-calls", label: "AI pipeline: calls", status: "double", buildId: "L2", keeper: "Company MIS, Quality: Voice recordings saved" },
  { page: "Live Health", key: "live-ai-failed", label: "AI pipeline: failed calls", status: "double", buildId: "L3", keeper: "Company MIS, Quality: Voice recordings saved" },
  { page: "Live Health", key: "live-ai-failure-rate", label: "AI pipeline: failure rate", status: "double", buildId: "L4", keeper: "Company MIS, Quality: Voice recordings saved" },
  { page: "Live Health", key: "live-ai-p95", label: "AI pipeline: P95 latency", status: "double", buildId: "L5", keeper: "Company MIS, Quality: Slowest 5%" },
  { page: "Voice Pipeline", key: "voice-calls", label: "Calls", status: "double", buildId: "V1", keeper: "Company MIS, Quality: Voice recordings saved" },
  { page: "Voice Pipeline", key: "voice-failed", label: "Failed calls", status: "double", buildId: "V2", keeper: "Company MIS, Quality: Voice recordings saved" },
  { page: "Voice Pipeline", key: "voice-success", label: "Success rate", status: "double", buildId: "V3", keeper: "Company MIS, Quality: Voice recordings saved" },
  { page: "Voice Pipeline", key: "voice-latency", label: "Average latency", status: "double", buildId: "V4", keeper: "Company MIS, Quality: Speech service time, average" },
  { page: "Voice Pipeline", key: "voice-daily", label: "Day-by-day table", status: "double", buildId: "V5", keeper: "Company MIS, Quality: the day-by-day lines of the three voice numbers" },
  { page: "Farmer Health", key: "fh-tiers", label: "Engagement tiers", status: "double", buildId: "FH3", keeper: "WVFD page: Tiers A to D" },
  { page: "Farmer Health", key: "fh-watchlist", label: "Watchlist (errors, 7 days)", status: "double", buildId: "FH6", keeper: "Suffering page: the watchlist" },
];

const BY_KEY = new Map(METRIC_LINES.map((m) => [m.key, m]));

/** The entry for one older-page number. Throws on an unknown key, so a typo cannot ship. */
export function metricLine(key: string): MetricLine {
  const m = BY_KEY.get(key);
  if (!m) throw new Error(`Unknown metric line: ${key}`);
  return m;
}
