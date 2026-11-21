/**
 * COPY FOR AI (CR-3 Task A8, founder decision D-156b).
 *
 * One page of the Company MIS as compact text, or as JSON, for the person to
 * paste into any assistant. Pure: the answer in, a string out. Nothing here
 * sends anything anywhere; the buttons put the string on the person's own
 * clipboard.
 *
 * Every value is the one the page shows, taken from the same adapter the page
 * reads (`misView.ts`), so text and screen agree. A value the server did not
 * count is "not measured" with its reason, never a 0. The company answer holds
 * no person's name, phone number, user id, farm id or place; organisation (FPO)
 * and crop names are the only names it carries, and they stay.
 */
import type { CompanyMis } from '@/hooks/useCompanyMis';
import { itemsOf, type MisItem, type MisSectionKey } from './misItems';
import { fmtDec, fmtInt, fmtPctPoints } from './misFormat';
import { fmtIndiaTime } from './misPeriod';
import {
  FPO_TODAYS_LINKS, SYNC_TEST_PHONES, TODAY_SO_FAR, testAccountsLine,
  acquisitionView, engagementView, farmsView, headlineFor, noun, overviewView, qualityView, retentionView,
  shownOf, type MisChart, type MisLineModel, type MisShown, type MisTileModel,
} from './misView';

/** The page names, as the menu and the page heading say them. */
export const MIS_PAGE_NAMES: Record<MisSectionKey, string> = {
  overview: 'Overview',
  acquisition: 'Acquisition',
  engagement: 'Engagement',
  retention: 'Retention',
  quality: 'Quality',
  farms: 'Farms & geography',
  operations: 'Operations',
};

interface Resolved {
  value: number | null;
  shown: string | null;
  notMeasured: string | null;
}

const NOT_MEASURED_YET = 'Not measured yet.';

const fromShown = (s: MisShown): Resolved =>
  s.kind === 'value'
    ? { value: s.value, shown: s.text, notMeasured: null }
    : { value: null, shown: null, notMeasured: s.why };

const text = (shown: string): Resolved => ({ value: null, shown, notMeasured: null });
const missing = (why: string): Resolved => ({ value: null, shown: null, notMeasured: why });

/** A chart card: its summary text, the measured nothing in words, or the reason there is none. */
function fromChart<T>(c: MisChart<T>, summary: (data: T) => string): Resolved {
  if (c.kind === 'chart') return text(summary(c.data));
  if (c.kind === 'none') return text(c.what);
  return missing(c.why);
}

const joined = (parts: string[]): string => parts.join('; ');

function fromLine(m: MisLineModel, fmt: (v: number) => string): string {
  return joined(m.current.map((v, i) => `${m.labels[i]} ${v === null ? 'not measured' : fmt(v)}`));
}

function tileOf(tiles: MisTileModel[], key: string): Resolved {
  const t = tiles.find((x) => x.item === key);
  if (!t) return missing(NOT_MEASURED_YET);
  const r = fromShown(t.current);
  /* W-2: an "as of the last day" number whose last day is today says so, as the page does. */
  return t.todaySoFar && r.shown !== null ? { ...r, shown: `${r.shown} (${TODAY_SO_FAR}, not compared)` } : r;
}

function overviewValues(d: CompanyMis, headline: string): Record<string, () => Resolved> {
  const v = overviewView(d);
  const tile = (key: string) => () => tileOf(v.tiles, key);
  return {
    'overview.activeFarms': () => {
      const r = fromShown(v.hero.current);
      return v.hero.todaySoFar && r.shown !== null ? { ...r, shown: `${r.shown} (${TODAY_SO_FAR}, not compared)` } : r;
    },
    'overview.signUps': tile('overview.signUps'),
    'overview.dau': tile('overview.dau'),
    'overview.wau': tile('overview.wau'),
    'overview.mau': tile('overview.mau'),
    'overview.stickiness': tile('overview.stickiness'),
    'overview.logsRecorded': tile('overview.logsRecorded'),
    'overview.voiceShare': tile('overview.voiceShare'),
    'overview.understanding': tile('overview.understanding'),
    'overview.logsByWeek': () => fromChart(v.logsByWeek, (c) =>
      joined(c.labels.map((l, i) => `${l} voice ${fmtInt(c.voice[i])}, typed ${fmtInt(c.typed[i])}`))),
    'overview.headline': () => text(headline),
  };
}

function acquisitionValues(d: CompanyMis): Record<string, () => Resolved> {
  const steps = acquisitionView(d).steps;
  const step = (key: string) => (): Resolved => {
    const s = steps.find((x) => x.item === key);
    if (!s) return missing(NOT_MEASURED_YET);
    const base = fromShown(s.current);
    if (s.pending) return text(s.pending);
    if (base.shown !== null && s.share) return { ...base, shown: `${base.shown} (${s.share.text} ${s.share.of})` };
    return base;
  };
  return {
    'acquisition.verified': step('acquisition.verified'),
    'acquisition.hasFarm': step('acquisition.hasFarm'),
    'acquisition.firstLog': step('acquisition.firstLog'),
    'acquisition.habit': step('acquisition.habit'),
  };
}

function engagementValues(d: CompanyMis, headline: string): Record<string, () => Resolved> {
  const v = engagementView(d);
  const e = d.engagement;
  return {
    'engagement.logsByType': () => fromChart(v.kinds, (c) => joined(c.rows.map((r) => `${r.label} ${fmtInt(r.entries)}`))),
    'engagement.logsPerFarm': () => {
      const r = fromShown(shownOf(e.logsPerActiveFarmPerWeek.current, 'decimal', 'engagement.logsPerFarm'));
      return d.lastDayComplete === false && r.shown !== null ? { ...r, shown: `${r.shown} (${TODAY_SO_FAR}, not compared)` } : r;
    },
    'engagement.whenLogged': () => fromChart(v.heat, (c) => {
      const total = c.grid.flat().reduce((a, b) => a + b, 0);
      return `${fmtInt(total)} entries by hour and weekday, India time; the busiest cell holds ${fmtInt(c.max)}`;
    }),
    'engagement.featureUse': () => fromChart(v.features, (c) => joined(c.rows.map((r) =>
      (r.people === null ? `${r.label} ${r.word}` : `${r.label} ${fmtInt(r.people)} people (${r.shareText})`)))),
    'engagement.roleMix': () => fromChart(v.roles, (c) => `${joined(c.parts.map((p) =>
      `${p.label} ${fmtInt(p.people)}${p.share ? ` (${p.share})` : ''}`))}${c.todaySoFar ? ` (${TODAY_SO_FAR}, not compared)` : ''}`),
    'engagement.featureByRole': () => fromChart(v.featureRoles, (c) => joined(c.rows.map((r) =>
      `${r.label}: ${c.roles.map((role, k) => (r.cells[k] === null ? null : `${role.label} ${fmtInt(r.cells[k] as number)}`))
        .filter((x): x is string => x !== null).join(', ')}`))),
    'engagement.headline': () => text(headline),
  };
}

function retentionValues(d: CompanyMis, headline: string): Record<string, () => Resolved> {
  const v = retentionView(d);
  const tile = (key: string) => () => tileOf(v.tiles, key);
  return {
    'retention.d1': tile('retention.d1'),
    'retention.d30': tile('retention.d30'),
    'retention.quiet': tile('retention.quiet'),
    'retention.silent30': tile('retention.silent30'),
    'retention.cohorts': () => fromChart(v.cohorts, (c) => joined(c.rows.map((r) =>
      `Week of ${r.label} (${fmtInt(r.people)} ${noun(r.people, 'person', 'people')}): ${['day 1', 'day 7', 'day 14', 'day 30']
        .map((name, k) => `${name} ${r.cells[k] === null ? 'not yet' : fmtPctPoints(r.cells[k] as number)}`).join(', ')}`))),
    'retention.curve': () => fromChart(v.curve, (c) => fromLine(c, (x) => fmtPctPoints(x))),
    'retention.bands': () => fromChart(v.bands, (c) => `${joined(c.parts.map((p) => `${p.label} ${p.text}`))}${c.asOf.includes(TODAY_SO_FAR) ? ` (${TODAY_SO_FAR}, not compared)` : ''}`),
    'retention.winBack': () => fromChart(v.winBack, (c) => fromLine(c, fmtInt)),
    'retention.headline': () => text(headline),
  };
}

function qualityValues(d: CompanyMis, headline: string): Record<string, () => Resolved> {
  const v = qualityView(d);
  const q = d.quality;
  const tile = (key: string) => () => tileOf(v.tiles, key);
  return {
    'quality.voiceSaved': tile('quality.voiceSaved'),
    'quality.transcriptionAvg': tile('quality.transcriptionAvg'),
    'quality.transcriptionP95': tile('quality.transcriptionP95'),
    'quality.corrected': tile('quality.corrected'),
    'quality.syncFailTile': tile('quality.syncFailTile'),
    'quality.scoreSpread': () => fromChart(v.spread, (c) => joined(c.labels.map((l, i) => `Score ${l} ${fmtInt(c.values[i])} farm-days`))),
    'quality.syncFailChart': () => fromChart(v.sync, () => {
      const refused = shownOf(q.syncRefusedChanges.current, 'count', 'quality.syncFailChart');
      const accepted = shownOf(q.syncAcceptedChanges.current, 'count', 'quality.syncFailChart');
      return `Refused ${refused.kind === 'value' ? refused.text : 'not measured'}, accepted ${accepted.kind === 'value' ? accepted.text : 'not measured'} in the range`;
    }),
    'quality.versionAdoption': () => fromChart(v.versions, (c) => joined(c.rows.map((r) =>
      `${r.version} (${r.seenOn}) ${fmtInt(r.people)} people (${r.shareText})`))),
    'quality.headline': () => text(headline),
  };
}

function farmsValues(d: CompanyMis): Record<string, () => Resolved> {
  const v = farmsView(d);
  const tile = (key: string) => () => tileOf(v.tiles, key);
  return {
    'farms.activeFarms': tile('farms.activeFarms'),
    'farms.registered': tile('farms.registered'),
    'farms.acres': tile('farms.acres'),
    'farms.inFpo': () => {
      const r = tile('farms.inFpo')();
      return r.shown !== null ? { ...r, shown: `${r.shown} (${FPO_TODAYS_LINKS})` } : r;
    },
    'farms.crops': () => fromChart(v.crops, (c) => joined(c.rows.map((r) =>
      `${r.label} ${fmtInt(r.farms)} ${noun(r.farms, 'farm', 'farms')}, ${fmtDec(r.acres, 1)} acres`))),
    'farms.perFpo': () => fromChart(v.perFpo, (c) => `${joined(c.rows.map((r) => `${r.label} ${fmtInt(r.farms)} ${noun(r.farms, 'farm', 'farms')}`))} (${FPO_TODAYS_LINKS})`),
    'farms.acresChart': () => fromChart(v.acres, (c) => joined(c.labels.map((l, i) => `${l} ${fmtDec(c.values[i], 1)} acres`))),
  };
}

function valuesFor(d: CompanyMis, section: MisSectionKey): Record<string, () => Resolved> {
  const headline = headlineFor(section, d, false);
  switch (section) {
    case 'overview': return overviewValues(d, headline);
    case 'acquisition': return acquisitionValues(d);
    case 'engagement': return engagementValues(d, headline);
    case 'retention': return retentionValues(d, headline);
    case 'quality': return qualityValues(d, headline);
    case 'farms': return farmsValues(d);
    case 'operations': return {};
  }
}

interface PackItem {
  key: string;
  label: string;
  value: number | null;
  shown: string | null;
  meaning: string;
  notMeasured: string | null;
}

function itemsOfPack(d: CompanyMis, section: MisSectionKey): PackItem[] {
  const values = valuesFor(d, section);
  return itemsOf(section).map((item: MisItem): PackItem => {
    /* An item the server does not count says so in its own words, whatever the answer holds. */
    const r = item.kind !== 'served' || !Object.prototype.hasOwnProperty.call(values, item.key)
      ? missing(item.why ?? NOT_MEASURED_YET)
      : values[item.key]();
    return { key: item.key, label: item.label, value: r.value, shown: r.shown, meaning: item.what, notMeasured: r.notMeasured };
  });
}

/** What the pack says about test accounts: the count, or that none are set up so test phones are counted (W-7). */
function testAccountsSentence(n: number): string {
  return n === 0 ? `${testAccountsLine(0)}.` : `Test accounts left out: ${n}.`;
}

/** Extra facts about the answer that change how the numbers are read; the page prints the same ones. */
export interface PackOptions {
  /** W-1: the sentence for "app events are not being recorded", or null when they are. */
  analyticsSentence?: string | null;
}

function caveatsOf(answer: CompanyMis, section: MisSectionKey, opts: PackOptions | undefined): string[] {
  const out: string[] = [];
  if (answer.lastDayComplete === false) {
    out.push('The last day of the range is today and is not over; numbers "as of the last day" are today so far and are not compared.');
  }
  if (opts?.analyticsSentence) out.push(`${opts.analyticsSentence} App version adoption and refused sync changes are not measured.`);
  if (section === 'quality' && answer.quality.syncAcceptedIncludesTestPhones === true) out.push(SYNC_TEST_PHONES);
  return out;
}

/** "ShramSafal Company MIS — {Page}", the range line, then one line per item of the page. */
export function misToAiText(answer: CompanyMis, section: MisSectionKey, opts?: PackOptions): string {
  const { range } = answer;
  const lines = [
    `ShramSafal Company MIS — ${MIS_PAGE_NAMES[section]}`,
    `Range ${range.from}..${range.to} (${range.days} days). Counted at ${fmtIndiaTime(answer.countedAtUtc)}. ${testAccountsSentence(answer.excludedTestAccounts)}`,
    ...caveatsOf(answer, section, opts),
    ...itemsOfPack(answer, section).map((i) =>
      (i.notMeasured !== null ? `${i.label}: not measured — ${i.notMeasured}` : `${i.label}: ${i.shown} — ${i.meaning}`)),
  ];
  return lines.join('\n');
}

/** The same content as `misToAiText`, as JSON. */
export function misToAiJson(answer: CompanyMis, section: MisSectionKey, opts?: PackOptions): string {
  const { range } = answer;
  const caveats = caveatsOf(answer, section, opts);
  return JSON.stringify({
    page: MIS_PAGE_NAMES[section],
    range: { from: range.from, to: range.to, days: range.days },
    countedAt: fmtIndiaTime(answer.countedAtUtc),
    testAccountsLeftOut: answer.excludedTestAccounts,
    ...(answer.excludedTestAccounts === 0 ? { testAccountsNote: testAccountsSentence(0) } : {}),
    ...(caveats.length > 0 ? { caveats } : {}),
    items: itemsOfPack(answer, section),
  }, null, 2);
}
