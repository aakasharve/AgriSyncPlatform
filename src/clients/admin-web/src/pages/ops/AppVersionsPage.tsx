import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, isValid } from 'date-fns';
import { Smartphone } from 'lucide-react';
import {
  useAppVersions,
  type AppVersions,
  type AppVersionsDays,
  type OlderVersionPerson,
} from '@/hooks/useAppVersions';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { KpiCard } from '@/components/ui/KpiCard';

// spec: control-room-app-versions-2026-11-12 (CR-1c Task V3).
// The page shows nothing the server did not measure: before the first row exists it says
// "Not measured yet" (never zero), a failed load says so (never an empty table), and
// "newest" always reads "newest seen in use" because the server does not know what the
// store has published. No phone number and no device identifier is ever shown.

const PERIODS: AppVersionsDays[] = [7, 30];
const NOT_MEASURED = 'Not measured yet';
const NO_NAME = 'No name on record';
const NO_FARM = 'No farm on record';

const TH = 'py-3 pr-4 text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted first:pl-4';
const TD = 'py-2.5 pr-4 align-top first:pl-4';

/** "12 Nov 2026". A date that cannot be read is shown as it came, never guessed. */
function readableDay(iso: string): string {
  const date = new Date(iso);
  return isValid(date) ? format(date, 'd MMM yyyy') : iso;
}

/** People on that version divided by everyone counted, rounded. Never divides by zero. */
function sharePct(people: number, everyone: number): number {
  return everyone > 0 ? Math.round((people * 100) / everyone) : 0;
}

function countOf(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function personName(p: OlderVersionPerson): string {
  return p.name?.trim() ? p.name : NO_NAME;
}

function farmLine(p: OlderVersionPerson): string {
  return p.farmNames.length > 0 ? p.farmNames.join(', ') : NO_FARM;
}

export default function AppVersionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const days: AppVersionsDays = searchParams.get('days') === '30' ? 30 : 7;
  const { data, isPending, isError, isFetching, refetch } = useAppVersions(days);

  function setDays(d: AppVersionsDays) {
    setSearchParams((prev) => { prev.set('days', String(d)); return prev; });
  }

  const loaded = !isError && !isPending && data ? data : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-teal to-brand-sky text-white shadow-[0_4px_12px_rgba(82,192,190,0.4)]">
            <Smartphone size={18} strokeWidth={2.5} />
          </span>
          Devices and app versions
        </h1>
        {loaded && (
          <span className="text-sm font-semibold text-text-muted">
            {loaded.measuredSinceUtc
              ? `Counting since ${readableDay(loaded.measuredSinceUtc)}`
              : 'Counting has not started'}
          </span>
        )}
      </div>

      <p className="px-1 text-[15px] text-text-primary">
        This page counts people who <b>used</b> the app. It does not count installs. Installs and
        uninstalls are in your Google Play Console.
      </p>

      {/* Period, kept in the URL */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm text-text-muted">Show use in the last</span>
        {PERIODS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
            className={`rounded-md border px-3 py-1.5 text-xs font-bold transition-colors ${
              days === d
                ? 'border-brand-teal bg-surface-kpi text-text-primary'
                : 'border-surface-border bg-transparent text-text-muted hover:bg-surface-sidebar'
            }`}
          >
            {d} days
          </button>
        ))}
      </div>

      {isError && (
        <div role="alert" className="glass-panel flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-base font-extrabold text-danger">Could not load this page</p>
          <p className="max-w-xl text-sm text-text-muted">
            The figures could not be loaded, so nothing is shown. This is not the same as nobody
            using the app.
          </p>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => { void refetch(); }}>
            Try again
          </Button>
        </div>
      )}

      {!isError && isPending && (
        <div role="status" className="flex flex-col gap-5">
          <span className="sr-only">Loading</span>
          <div className="grid grid-cols-4 gap-3.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[120px] animate-pulse rounded-xl bg-surface-sidebar" />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-xl bg-surface-sidebar" />
        </div>
      )}

      {loaded && <Loaded data={loaded} days={days} />}

      <p className="px-1 text-sm text-text-muted">
        This page never shows a phone number or a phone's identifier. It shows counts, names and
        farm names only.
      </p>
    </div>
  );
}

function Loaded({ data, days }: { data: AppVersions; days: AppVersionsDays }) {
  const [search, setSearch] = useState('');

  const measured = data.measuredSinceUtc !== null;
  const olderCount = data.versions.reduce((sum, v) => (v.isNewest ? sum : sum + v.people), 0);

  const q = search.trim().toLowerCase();
  const shown = data.onOlderVersions.filter(
    (p) => !q || `${personName(p)} ${farmLine(p)} ${p.appVersion}`.toLowerCase().includes(q)
  );

  const deviceNote =
    `${countOf(data.otherDevices, 'browser sign-in', 'browser sign-ins')} · ` +
    `${countOf(data.peopleWithUnknownDevice, 'person', 'people')} whose sign-in did not say which device ` +
    '(this includes sign-ins to this console and app versions 1.0.15 to 1.0.17)';

  return (
    <>
      {/* Figures. The device figures come from sign-ins, so they show even before counting starts. */}
      <div className="grid grid-cols-4 gap-3.5">
        {measured
          ? <KpiCard label="People who used the app" value={data.people.toLocaleString()} />
          : <QuietFigure label="People who used the app" value={NOT_MEASURED} />}
        <KpiCard label="Phones signed in" value={data.phones.toLocaleString()} note={deviceNote} />
        {measured
          ? <KpiCard label="People on an older version" value={olderCount.toLocaleString()} />
          : <QuietFigure label="People on an older version" value={NOT_MEASURED} />}
        <QuietFigure label="Installs" value="see Play Console" />
      </div>

      {!measured && (
        <Card>
          <CardHeader><CardTitle>{NOT_MEASURED}</CardTitle></CardHeader>
          <CardContent>
            <p className="max-w-3xl text-sm text-text-primary">
              The server has not recorded any use by version so far. The first numbers appear the
              first time someone opens the app after this page goes live. This is not the same as
              nobody using the app.
            </p>
          </CardContent>
        </Card>
      )}

      {measured && (
        <>
          {/* Versions */}
          <div className="glass-panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-row-divider">
                  <th className={TH}>App version</th>
                  <th className={TH}>People</th>
                  <th className={TH}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.versions.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-sm text-text-muted">
                      No one was seen using the app in the last {days} days.
                    </td>
                  </tr>
                )}
                {data.versions.map((v) => {
                  const pct = sharePct(v.people, data.people);
                  return (
                    <tr key={v.appVersion} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                      <td className={TD}>
                        <span className="font-mono text-[13px] font-bold text-text-primary">{v.appVersion}</span>
                        <span
                          className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[11px] font-bold text-text-primary ${
                            v.isNewest ? 'bg-success/15' : 'bg-warning/15'
                          }`}
                        >
                          {v.isNewest ? 'newest seen in use' : 'older'}
                        </span>
                      </td>
                      <td className={TD}>
                        <span className="font-mono text-[13px] font-bold text-text-primary">{v.people.toLocaleString()}</span>
                      </td>
                      <td className={TD}>
                        <div className="flex items-center gap-3">
                          <div
                            role="img"
                            aria-label={`${pct} percent of people`}
                            className="h-2.5 w-40 overflow-hidden rounded-full bg-surface-sidebar"
                          >
                            <div className="h-full rounded-full bg-brand-teal" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className="text-[12px] text-text-muted">{pct}% of people</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Card>
            <CardHeader><CardTitle>How this is counted</CardTitle></CardHeader>
            <CardContent>
              <p className="max-w-3xl text-sm text-text-primary">
                Each person is counted once, on the version they were most recently seen using in
                the period. Phones are one total taken from sign-ins, so they cannot be split by
                version. People whose app sends no version are not on this page.
              </p>
            </CardContent>
          </Card>

          {/* People on an older version */}
          <div className="flex items-center justify-between px-1">
            <h2 className="text-lg font-extrabold tracking-tight text-text-primary">People still on an older version</h2>
            {data.onOlderVersions.length > 0 && (
              <span className="text-sm text-text-muted">{shown.length.toLocaleString()} shown</span>
            )}
          </div>

          {data.onOlderVersions.length === 0 ? (
            <div className="glass-panel py-10 text-center text-sm text-text-muted">
              No one was seen on an older version in the last {days} days.
            </div>
          ) : (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a person, farm or version"
                aria-label="Search people on an older version"
                className="w-80 rounded-md border-2 border-surface-border bg-surface-kpi px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-teal"
              />

              {data.onOlderVersions.length < olderCount && (
                <p className="px-1 text-sm text-text-muted">
                  This list shows the {data.onOlderVersions.length.toLocaleString()} people seen most
                  recently, out of {olderCount.toLocaleString()}.
                </p>
              )}

              {shown.length === 0 ? (
                <div className="glass-panel py-10 text-center text-sm text-text-muted">
                  Nothing matches that search. Your search left everyone out; that is not the same
                  as everyone being up to date.
                </div>
              ) : (
                <div className="glass-panel overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-row-divider">
                        <th className={TH}>Person and farm</th>
                        <th className={TH}>Version</th>
                        <th className={TH}>Last used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p, i) => (
                        <tr key={i} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                          <td className={TD}>
                            <span className="block font-bold text-text-primary">{personName(p)}</span>
                            <span className="block text-[12px] text-text-muted">{farmLine(p)}</span>
                          </td>
                          <td className={TD}>
                            <span className="inline-block rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[12px] font-bold text-text-primary">
                              {p.appVersion}
                            </span>
                          </td>
                          <td className={TD}>
                            <span className="whitespace-nowrap text-[13px] text-text-primary">{readableDay(p.lastSeenUtc)}</span>
                          </td>
                        </tr>
                      ))}
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

/** A figure whose value is words, not a number: same shell as KpiCard, quieter type. */
function QuietFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-kpi flex flex-col gap-2 p-5">
      <div className="text-[13px] font-bold tracking-tight text-text-primary">{label}</div>
      <div className="text-[18px] font-semibold leading-snug text-text-muted">{value}</div>
    </div>
  );
}
