/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — the words, states and dates of चाचण्या
 * in one place, so the queue, its cards, its two sheets and the detail page all say the same thing. Pure: no
 * React, no store, no sample data (the preview's `farmData.ts` TESTS never comes here).
 *
 * The real states, said honestly in the approved vocabulary (PLR-D9 `PlacePages.TestsPage`):
 *   - Overdue   → "वेळ उलटून गेली" — its own group, on top, red: a real state worth seeing first;
 *   - Due       → "करायची आहे";
 *   - Collected → "नमुना घेतला". The preview says "नमुना पाठवला" (sent), but the app records that the sample
 *                 was TAKEN (`collectedAtUtc`), never that it was sent anywhere, and the button that moves a
 *                 test here has always said "नमुना घेतला". One word to swap if the founder prefers पाठवला;
 *   - Reported  → "निकाल आला";
 *   - Waived    → "सूट दिली" (the queue never lists these; the label is for completeness).
 * A date is shown only when it was recorded; a day count only when both days are real. Every Marathi string
 * here is PROPOSED (the Marathi review pass has not seen it).
 */
import type { DexieTestInstance, DexieTestProtocol, DexieTestResult } from '../../../infrastructure/storage/DexieDatabase';
import { TestInstanceStatus } from '../../../domain/tests/TestInstance';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { MARATHI_MONTHS } from '../../labour/marathiDate';
import type { Tone } from '../../../shared/components/ui/placeUi';

export const TESTS_TITLE = 'चाचण्या';
export const TESTS_EXPLAINER = 'माती, पाणी आणि पानांच्या तपासण्या — काय करायचं, कोणता नमुना घेतला, काय निकाल आला.';
/** The empty sentence, unchanged from before the redesign: true when the list really has nothing. */
export const TESTS_EMPTY = 'आज कोणत्याही चाचण्या नाहीत';

export type TestState = 'overdue' | 'due' | 'collected' | 'reported' | 'waived';

/** The real stored status → its state. `null` for a value the app does not know (never listed). */
export function stateOf(status: number): TestState | null {
    switch (status) {
        case TestInstanceStatus.Overdue: return 'overdue';
        case TestInstanceStatus.Due: return 'due';
        case TestInstanceStatus.Collected: return 'collected';
        case TestInstanceStatus.Reported: return 'reported';
        case TestInstanceStatus.Waived: return 'waived';
        default: return null;
    }
}

export const STATE_VIEW: Record<TestState, { label: string; tone: Tone; hint?: string }> = {
    overdue: { label: 'वेळ उलटून गेली', tone: 'rose', hint: 'ठरलेली तारीख गेली — नमुना अजून घ्यायचा आहे' },
    due: { label: 'करायची आहे', tone: 'amber', hint: 'नमुना घ्यायचा आहे' },
    collected: { label: 'नमुना घेतला', tone: 'blue', hint: 'लॅबचा निकाल यायचा आहे' },
    reported: { label: 'निकाल आला', tone: 'green' },
    waived: { label: 'सूट दिली', tone: 'stone' },
};

/** The one thing a card's button does, per state (waived has none). */
export const ACTION_LABEL: Partial<Record<TestState, string>> = {
    overdue: 'नमुना घेतला',
    due: 'नमुना घेतला',
    collected: 'निकाल नोंदवा',
    reported: 'निकाल पहा',
};

const KIND_LABEL: Record<number, string> = {
    0: 'मातीची तपासणी',
    1: 'पाण्याची तपासणी',
    2: 'पानांची तपासणी',
    3: 'औषध-अवशेष तपासणी',
    4: 'इतर तपासणी',
};
export const kindLabel = (kind: number): string => KIND_LABEL[kind] ?? KIND_LABEL[4];

/** What the test is: the server's protocol name as it comes (it can be English), else the kind in Marathi. */
export const testName = (instance: DexieTestInstance, protocol?: DexieTestProtocol): string =>
    instance.testProtocolName?.trim() || protocol?.name?.trim() || kindLabel(instance.protocolKind);

/**
 * The kind under the name, only when it adds something. The client maps every server kind it does not know
 * (Petiole, Drainage, LandAmendment, Custom) to "Other" (`testsClient.mapKindString`), so "इतर तपासणी" under
 * a real name would say nothing — it is left out, as is a kind that IS the name.
 */
export const kindLine = (instance: DexieTestInstance, name: string): string => {
    const label = KIND_LABEL[instance.protocolKind];
    return !label || instance.protocolKind === 4 || label === name ? '' : label;
};

/** Where: the farm's own plot name and the server's stage name, whichever are known. */
export const whereLine = (instance: DexieTestInstance, plotName?: string): string =>
    [plotName, instance.stageName].map(s => s?.trim()).filter(Boolean).join(' · ');

// ---------------------------------------------------------------- dates

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const keyParts = (key: string | undefined): [number, number, number] | null => {
    const m = DATE_KEY.exec((key ?? '').slice(0, 10));
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? [y, mo, d] : null;
};

/** `25 ऑक्टो`, with the year when it is not this year. '' when it cannot be read — never a made-up date. */
export function formatDayKey(key: string | undefined, todayKey: string = getDateKey()): string {
    const p = keyParts(key);
    if (!p) return '';
    const label = `${p[2]} ${MARATHI_MONTHS[p[1] - 1]}`;
    return todayKey.slice(0, 4) === String(p[0]) ? label : `${label} ${p[0]}`;
}

/** A recorded instant (`collectedAtUtc`, `reportedAtUtc`) as the farm's calendar day (IST). */
export function formatInstantDay(iso: string | undefined, todayKey: string = getDateKey()): string {
    if (!iso) return '';
    const t = Date.parse(iso);
    return Number.isNaN(t) ? '' : formatDayKey(getDateKey(new Date(t)), todayKey);
}

/** Whole days from `fromKey` to `toKey` (negative when `toKey` is earlier). `null` if either is unreadable. */
export function daysBetweenKeys(fromKey: string, toKey: string): number | null {
    const a = keyParts(fromKey);
    const b = keyParts(toKey);
    if (!a || !b) return null;
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY_MS);
}

/** `YYYY-MM-DD` plus `days`, as a `YYYY-MM-DD` key (calendar arithmetic, no clock involved). */
export function addDaysToKey(key: string, days: number): string {
    const p = keyParts(key);
    if (!p) return key;
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** When: the planned day, how late an overdue one is, and the day the sample / result was recorded. */
export function whenLine(instance: DexieTestInstance, todayKey: string = getDateKey()): string {
    const parts: string[] = [];
    const due = formatDayKey(instance.plannedDueDate, todayKey);
    if (due) parts.push(`ठरलेली तारीख ${due}`);
    const state = stateOf(instance.status);
    if (state === 'overdue') {
        const late = daysBetweenKeys(instance.plannedDueDate, todayKey);
        if (late !== null && late > 0) parts.push(`${late} दिवस उशीर`);
    }
    if (state === 'collected') {
        const d = formatInstantDay(instance.collectedAtUtc, todayKey);
        if (d) parts.push(`नमुना घेतला ${d}`);
    }
    if (state === 'reported') {
        const d = formatInstantDay(instance.reportedAtUtc, todayKey);
        if (d) parts.push(`निकाल आला ${d}`);
    }
    return parts.join(' · ');
}

/** The protocol's parameter codes (server data), four at most, with how many there are. '' when none. */
export function paramsLine(protocol?: DexieTestProtocol): string {
    const codes = protocol?.parameterCodes ?? [];
    if (codes.length === 0) return '';
    return `तपासायचे घटक (${codes.length}): ${codes.slice(0, 4).join(', ')}${codes.length > 4 ? '…' : ''}`;
}

/** The recorded results as one line (`नत्र 140 किलो · स्फुरद 18`). '' when the phone holds none. */
export const resultLine = (results: readonly DexieTestResult[] | undefined): string =>
    (results ?? [])
        .map(r => [r.parameterCode, r.parameterValue, r.unit].map(s => s?.trim()).filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' · ');

// ---------------------------------------------------------------- results against their range

export type RangeVerdict = 'ok' | 'low' | 'high';

/** Within / below / above the recorded reference range; `null` when there is no range or no number. */
export function rangeVerdict(r: DexieTestResult): RangeVerdict | null {
    if (r.referenceRangeLow == null || r.referenceRangeHigh == null) return null;
    if ((r.parameterValue ?? '').trim() === '') return null;
    const n = Number(r.parameterValue);
    if (Number.isNaN(n)) return null;
    if (n < r.referenceRangeLow) return 'low';
    if (n > r.referenceRangeHigh) return 'high';
    return 'ok';
}

export const VERDICT_VIEW: Record<RangeVerdict, { label: string; tone: Tone }> = {
    ok: { label: 'ठीक', tone: 'green' },
    low: { label: 'कमी', tone: 'amber' },
    high: { label: 'जास्त', tone: 'amber' },
};

// ---------------------------------------------------------------- filters and groups

/** The page's real filters (and the `?filter=` values), unchanged; only their words are Marathi now. */
export type TestFilter = 'All' | 'Due' | 'Overdue' | 'Reported';
export const FILTER_ITEMS: readonly (readonly [TestFilter, string])[] = [
    ['All', 'सर्व'],
    ['Overdue', STATE_VIEW.overdue.label],
    ['Due', STATE_VIEW.due.label],
    ['Reported', STATE_VIEW.reported.label],
];
export const isTestFilter = (v: string | null): v is TestFilter =>
    v === 'All' || v === 'Due' || v === 'Overdue' || v === 'Reported';

export const GROUP_ORDER = ['overdue', 'due', 'collected', 'reported'] as const;
export type GroupKey = typeof GROUP_ORDER[number];
export type TestGroups = Record<GroupKey, DexieTestInstance[]>;

const byDueAsc = (a: DexieTestInstance, b: DexieTestInstance) => a.plannedDueDate.localeCompare(b.plannedDueDate);
const byReportedDesc = (a: DexieTestInstance, b: DexieTestInstance) =>
    (b.reportedAtUtc ?? b.plannedDueDate).localeCompare(a.reportedAtUtc ?? a.plannedDueDate);

/**
 * Rows into their state groups, then the filter — the same rule the page always had: "करायची आहे" shows only
 * Due, "वेळ उलटून गेली" only Overdue, "निकाल आला" only Reported, "सर्व" all four (a waived test is never
 * listed). To-do groups put the oldest planned day first; results put the newest first.
 */
export function groupTests(rows: readonly DexieTestInstance[], filter: TestFilter): TestGroups {
    const g: TestGroups = { overdue: [], due: [], collected: [], reported: [] };
    for (const row of rows) {
        const s = stateOf(row.status);
        if (s && s !== 'waived') g[s].push(row);
    }
    g.overdue.sort(byDueAsc);
    g.due.sort(byDueAsc);
    g.collected.sort(byDueAsc);
    g.reported.sort(byReportedDesc);
    const none: TestGroups = { overdue: [], due: [], collected: [], reported: [] };
    if (filter === 'Due') return { ...none, due: g.due };
    if (filter === 'Overdue') return { ...none, overdue: g.overdue };
    if (filter === 'Reported') return { ...none, reported: g.reported };
    return g;
}

// ---------------------------------------------------------------- failures, in words

export const FAILURE_NO_PERMISSION = 'ही नोंद करायची परवानगी तुम्हाला नाही.';
/** The sheet's close refreshes the list (TestQueuePage), which is what makes "यादी ताजी होईल" true. */
export const FAILURE_MOVED_ON = 'ही चाचणी आधीच पुढच्या टप्प्यावर गेली आहे. हे बंद करा — यादी ताजी होईल.';
export const FAILURE_REPORT_NOT_UPLOADED = 'रिपोर्टची फाइल अजून सर्व्हरवर पोचलेली नाही. थोड्या वेळाने पुन्हा जतन करा.';

/**
 * A failed call → one plain Marathi line (review B003). Reads the `status` / `code` a `TestsApiError` carries
 * (duck-typed, so this file stays free of the client). Who may record what is NOT decided here: this only
 * says what the server answered.
 *   403                                → no permission;
 *   400 ShramSafal.TestInvalidState    → the test has already moved on;
 *   400 ShramSafal.TestAttachmentInvalid → the report file has not reached the server yet (it uploads in the
 *                                         background after it is attached);
 *   anything else                      → `fallback` (the caller's "… पुन्हा प्रयत्न करा").
 */
export function failureWords(error: unknown, fallback: string): string {
    const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };
    if (status === 403) return FAILURE_NO_PERMISSION;
    if (status === 400 && code === 'ShramSafal.TestInvalidState') return FAILURE_MOVED_ON;
    if (status === 400 && code === 'ShramSafal.TestAttachmentInvalid') return FAILURE_REPORT_NOT_UPLOADED;
    return fallback;
}

/** A recommendation's "do it in N days", in words. */
export const offsetWords = (days: number): string => (days <= 0 ? 'आजच करायचं' : `${days} दिवसांनी करायचं`);

/** Plot names from the phone's copy of the farm's plots (`db.plots[].payload.name`); unknown ids are skipped. */
export function plotNamesFrom(rows: readonly { id: string; payload: unknown }[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of rows) {
        const name = (r.payload as { name?: unknown } | null)?.name;
        if (typeof name === 'string' && name.trim()) out[r.id] = name.trim();
    }
    return out;
}
