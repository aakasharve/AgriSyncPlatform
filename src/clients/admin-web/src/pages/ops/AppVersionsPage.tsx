import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import {
  useAppVersions,
  type AppVersions,
  type AppVersionsAnswer,
  type AppVersionsDays,
  type OlderVersionPerson,
} from '@/hooks/useAppVersions';
import {
  LoadFailed,
  LoadingState,
  MeasuredZero,
  NoMatch,
  NotMeasured,
  NotMeasuredPanel,
} from '@/components/state';
import { KpiCard } from '@/components/ui/KpiCard';
import { PersonName } from '@/components/ui/PersonName';
import { DATE_FORMATS, fmt } from '@/lib/format';

// spec: control-room-app-versions-2026-11-12 (CR-1c Tasks V3 and V4).
// The page shows nothing the server did not measure: before the first row exists it says
// "Not measured yet" (never zero), a failed load says so (never an empty table), and
// "newest" always reads "newest seen in use" because the server does not know what the
// store has published. No phone number and no device identifier is ever shown.
//
// Every release up to 1.0.17 reports the same number, which was never a release. The server
// names that number (legacyVersionNumber); the page shows it as "1.0.17 or earlier" with the
// reported number beside it, never as if it were a release.
//
// Phones and browsers apart (D-141 default): only Android phones are counted as phones; browser
// sign-ins are shown in the small line under that number.
//
// CR-2d join (plan Task 3 Step 1): the recording lane wrote this page for the older console
// shell. It is ported onto the September console's components and state rules only: the four
// causes (LoadFailed, LoadingState, MeasuredZero, NoMatch), KpiCard's honesty state, NotMeasured
// for a single missing value, PersonName for every name (font rule), the token layer's classes.
// A figure the server did not send reads "not measured", never 0. The words are the lane's.

const PERIODS: AppVersionsDays[] = [7, 30];
const NOT_MEASURED = 'Not measured yet';
const NO_NAME = 'No name on record';
const NO_FARM = 'No farm on record';
const LEGACY_LABEL = '1.0.17 or earlier';
/** Used only in the "How this is counted" sentence, and only when the server did not name the number. */
const LEGACY_NUMBER_IN_WORDS = '0.9.0';
/** Why a single figure is absent when the answer arrived without it. */
const NOT_SENT = 'The server did not send this figure, so it is not shown as a number.';

const TH =
  'whitespace-nowrap border-b border-line bg-panel-head px-4 py-3.5 text-left align-bottom text-caption font-bold text-text-2';
const TD = 'px-4 py-2.5 align-top text-body text-text-1';
const ROW = 'border-b border-line last:border-0';

/**
 * "12 Nov 2026". A date that cannot be read is shown as it came, never guessed. Read through the
 * console's one date module (Register A51: no screen imports date-fns), with this page's own
 * pattern, unchanged.
 */
function readableDay(iso: string): string {
  return fmt.date(iso, 'd MMM yyyy') ?? iso;
}

/** A count the server sent, or null when it did not: a missing figure is never a zero. */
function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** People on that version divided by everyone counted, rounded. Null when either is missing or nobody was counted. */
function sharePct(people: number | null, everyone: number | null): number | null {
  if (people === null || everyone === null || everyone <= 0) return null;
  return Math.round((people * 100) / everyone);
}

function countWords(n: number, one: string, many: string): string {
  return `${fmt.num(n)} ${n === 1 ? one : many}`;
}

function farmLine(p: OlderVersionPerson): ReactNode {
  if (p.farmNames.length === 0) return NO_FARM;
  return p.farmNames.map((name, i) => (
    <span key={i}>
      {i > 0 && ', '}
      <PersonName name={name} fallback={NO_FARM} />
    </span>
  ));
}

/**
 * The day counting began, or null when nothing has been recorded yet. The one test the whole
 * page uses: null, undefined and an empty string all mean "not measured".
 */
function measuredSince(data: AppVersions): string | null {
  const since: unknown = data.measuredSinceUtc;
  return typeof since === 'string' && since !== '' ? since : null;
}

/**
 * The number old releases report, or null when the server did not send it. When it is null
 * nothing is relabelled and every version is shown as it came.
 */
function legacyNumberOf(data: AppVersions): string | null {
  const reported: unknown = data.legacyVersionNumber;
  return typeof reported === 'string' && reported !== '' ? reported : null;
}

/**
 * "reports as 0.9.0" for the number old releases report; null for every other version. The
 * one place that decides whether a version is relabelled.
 */
function legacyNote(appVersion: string, legacyNumber: string | null): string | null {
  return legacyNumber !== null && appVersion === legacyNumber ? `reports as ${legacyNumber}` : null;
}

/** What the page shows for a version: its own number, or the label for the number old releases report. */
function versionLabel(appVersion: string, legacyNumber: string | null): string {
  return legacyNote(appVersion, legacyNumber) !== null ? LEGACY_LABEL : appVersion;
}

/** Everything the search box looks through for one person: what is on the screen, plus the raw number. */
function searchText(p: OlderVersionPerson, legacyNumber: string | null): string {
  const note = legacyNote(p.appVersion, legacyNumber);
  const version = note !== null ? `${p.appVersion} ${LEGACY_LABEL} ${note}` : p.appVersion;
  const name = p.name?.trim() ? p.name : NO_NAME;
  const farms = p.farmNames.length > 0 ? p.farmNames.join(', ') : NO_FARM;
  return `${name} ${farms} ${version}`.toLowerCase();
}

/** The server's own time of the answer, in words; never this browser's clock. */
function checkedAtWords(data: AppVersionsAnswer): string {
  return fmt.dateTime(data.checkedAtUtc, DATE_FORMATS.usersLastLogin) ?? 'a time the server did not report';
}

export default function AppVersionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const days: AppVersionsDays = searchParams.get('days') === '30' ? 30 : 7;
  const { data, isPending, isError, error, refetch } = useAppVersions(days);

  function setDays(d: AppVersionsDays) {
    setSearchParams((prev) => { prev.set('days', String(d)); return prev; });
  }

  const loaded = !isError && !isPending && data ? data : null;
  const since = loaded ? measuredSince(loaded) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <Smartphone size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Devices and app versions
          </h1>
          <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
            This page counts people who <b>used</b> the app. It does not count installs. Installs and
            uninstalls are in your Google Play Console.
          </p>
        </div>
        {loaded && (
          <span className={since !== null ? 'text-caption text-text-2' : 'text-caption text-text-3'}>
            {since !== null
              ? `Counting since ${readableDay(since)}`
              : 'Counting has not started'}
          </span>
        )}
      </div>

      {/* Period, kept in the URL */}
      <div
        role="group"
        aria-label="Show use in the last"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-4"
      >
        <span className="flex-none text-caption font-semibold text-text-2">Show use in the last</span>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`glass-quiet rounded-full border border-control-edge px-3.5 py-2 text-body ${
                days === d ? 'font-semibold text-text-1' : 'text-text-2'
              }`}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <LoadFailed error={error} onRetry={() => void refetch()} what="the app versions" />
      )}

      {!isError && isPending && <LoadingState label="Loading the app versions…" />}

      {loaded && <Loaded data={loaded} days={days} />}

      <p className="text-caption text-text-2">
        This page never shows a phone number or a phone's identifier. It shows counts, names and
        farm names only.
      </p>
    </div>
  );
}

function Loaded({ data, days }: { data: AppVersionsAnswer; days: AppVersionsDays }) {
  const [search, setSearch] = useState('');

  const measured = measuredSince(data) !== null;
  const legacyNumber = legacyNumberOf(data);
  const people = countOf(data.people);
  const phones = countOf(data.phones);
  const otherDevices = countOf(data.otherDevices);
  const unknownDevice = countOf(data.peopleWithUnknownDevice);
  // Every version row must carry its count, or the total of people behind is not known.
  const olderCount = data.versions.reduce<number | null>((sum, v) => {
    if (sum === null || v.isNewest) return sum;
    const n = countOf(v.people);
    return n === null ? null : sum + n;
  }, 0);

  const q = search.trim().toLowerCase();
  const shown = data.onOlderVersions.filter((p) => !q || searchText(p, legacyNumber).includes(q));

  const deviceNote =
    `${otherDevices !== null ? countWords(otherDevices, 'browser sign-in', 'browser sign-ins') : 'browser sign-ins: not measured'} · ` +
    `${unknownDevice !== null ? countWords(unknownDevice, 'person', 'people') : 'people: not measured'} whose sign-in did not say which device ` +
    '(this includes sign-ins to this console and app versions 1.0.15 to 1.0.17)';

  return (
    <>
      {/* Figures. The device figures come from sign-ins, so they show even before counting starts. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {measured && people !== null ? (
          <KpiCard label="People who used the app" value={fmt.num(people)} />
        ) : (
          <KpiCard
            label="People who used the app"
            value={null}
            state="unmeasured"
            caption={measured ? NOT_SENT : NOT_MEASURED}
          />
        )}
        {phones !== null ? (
          <KpiCard label="Phones signed in" value={fmt.num(phones)} note={deviceNote} />
        ) : (
          <KpiCard label="Phones signed in" value={null} state="unmeasured" caption={NOT_SENT} note={deviceNote} />
        )}
        {measured && olderCount !== null ? (
          <KpiCard label="People on an older version" value={fmt.num(olderCount)} />
        ) : (
          <KpiCard
            label="People on an older version"
            value={null}
            state="unmeasured"
            caption={measured ? NOT_SENT : NOT_MEASURED}
          />
        )}
        <KpiCard label="Installs" value={null} state="unmeasured" caption="see Play Console" />
      </div>

      {!measured && (
        <NotMeasuredPanel
          title={NOT_MEASURED}
          why={
            <p className="max-w-[var(--text-measure)]">
              The server has not recorded any use by version so far. The first numbers appear the
              first time someone opens the app after this page goes live. This is not the same as
              nobody using the app.
            </p>
          }
        />
      )}

      {measured && (
        <>
          {/* Versions */}
          {data.versions.length === 0 ? (
            <MeasuredZero
              what={`No one was seen using the app in the last ${days} days`}
              checkedAt={checkedAtWords(data)}
            />
          ) : (
            <div className="glass-panel overflow-x-auto rounded-panel">
              <table className="w-full border-collapse" aria-label="App versions in use">
                <thead>
                  <tr>
                    <th scope="col" className={TH}>App version</th>
                    <th scope="col" className={TH}>People</th>
                    <th scope="col" className={TH}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.versions.map((v) => {
                    const count = countOf(v.people);
                    const pct = sharePct(count, people);
                    const note = legacyNote(v.appVersion, legacyNumber);
                    return (
                      <tr key={v.appVersion} className={ROW}>
                        <td className={TD}>
                          <span className="font-mono font-semibold text-text-1">
                            {versionLabel(v.appVersion, legacyNumber)}
                          </span>
                          <span
                            className={`ml-2 inline-block rounded-chip px-2 py-0.5 text-caption font-semibold text-text-1 ${
                              v.isNewest ? 'bg-tint-green' : 'bg-tint-amber'
                            }`}
                          >
                            {v.isNewest ? 'newest seen in use' : 'older'}
                          </span>
                          {note !== null && (
                            <span className="mt-0.5 block text-caption text-text-2">{note}</span>
                          )}
                        </td>
                        <td className={TD}>
                          {count !== null ? (
                            <span className="tabular-nums font-semibold">{fmt.num(count)}</span>
                          ) : (
                            <NotMeasured why={NOT_SENT} />
                          )}
                        </td>
                        <td className={TD}>
                          {pct !== null ? (
                            <div className="flex items-center gap-3">
                              <div
                                role="img"
                                aria-label={`${pct} percent of people`}
                                className="h-2.5 w-40 overflow-hidden rounded-full bg-line"
                              >
                                <div className="h-full rounded-full bg-blue-vivid" style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <span className="text-caption text-text-2">{pct}% of people</span>
                            </div>
                          ) : (
                            <NotMeasured why="The share needs both this version's count and the total of people." />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="glass-panel rounded-panel p-6">
            <h2 className="text-h3 font-semibold text-text-1">How this is counted</h2>
            <p className="mt-2 max-w-[var(--text-measure)] text-body text-text-1">
              Each person is counted once. If a person was seen on two versions in the period,
              the one that appeared later counts. Releases up to 1.0.17 all report the same
              number ({legacyNumber ?? LEGACY_NUMBER_IN_WORDS}), so they cannot be told apart;
              from 1.0.18 the app reports its real version. Phones are one total taken from
              sign-ins, so they cannot be split by version. People whose app sends no version
              are not on this page.
            </p>
          </div>

          {/* People on an older version */}
          <div className="flex items-center justify-between">
            <h2 className="text-h2 font-bold text-text-1">People still on an older version</h2>
            {data.onOlderVersions.length > 0 && (
              <span className="text-caption text-text-2">{fmt.num(shown.length)} shown</span>
            )}
          </div>

          {data.onOlderVersionsHiddenReason === 'needs_all_farms' ? (
            /* CR-3 (AM7): the counts above stand; the names need the All farms tick. Said, never an
               empty list: an empty list would read as "nobody is on an older version". */
            <p data-hidden-reason="needs_all_farms" className="glass-panel rounded-panel px-5 py-4 text-body text-text-1">
              Names are hidden: seeing who is on an older version needs the All farms tick.
            </p>
          ) : data.onOlderVersions.length === 0 ? (
            <MeasuredZero
              what={`No one was seen on an older version in the last ${days} days`}
              checkedAt={checkedAtWords(data)}
            />
          ) : (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a person, farm or version"
                aria-label="Search people on an older version"
                className="glass-quiet w-80 rounded-chip border border-control-edge px-3.5 py-2.5 text-body text-text-1 focus:border-brand"
              />

              {olderCount !== null && data.onOlderVersions.length < olderCount && (
                <p className="text-caption text-text-2">
                  This list shows the {fmt.num(data.onOlderVersions.length)} people seen most
                  recently, out of {fmt.num(olderCount)}.
                </p>
              )}

              {shown.length === 0 ? (
                <NoMatch
                  filterInWords={`"${search.trim()}"`}
                  onClear={() => setSearch('')}
                  searchesOver="The search looks through each person's name, their farms and their version."
                />
              ) : (
                <div className="glass-panel overflow-x-auto rounded-panel">
                  <table className="w-full border-collapse" aria-label="People still on an older version">
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>Person and farm</th>
                        <th scope="col" className={TH}>Version</th>
                        <th scope="col" className={TH}>Last used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p, i) => {
                        const note = legacyNote(p.appVersion, legacyNumber);
                        return (
                          <tr key={i} className={ROW}>
                            <td className={TD}>
                              <span className="block font-semibold text-text-1">
                                <PersonName name={p.name} fallback={NO_NAME} />
                              </span>
                              <span className="block text-caption text-text-2">{farmLine(p)}</span>
                            </td>
                            <td className={TD}>
                              <span className="inline-block whitespace-nowrap rounded-chip bg-tint-amber px-2 py-0.5 font-mono text-caption font-semibold text-text-1">
                                {versionLabel(p.appVersion, legacyNumber)}
                              </span>
                              {note !== null && (
                                <span className="mt-0.5 block whitespace-nowrap text-caption text-text-2">{note}</span>
                              )}
                            </td>
                            <td className={TD}>
                              <span className="whitespace-nowrap">{readableDay(p.lastSeenUtc)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
