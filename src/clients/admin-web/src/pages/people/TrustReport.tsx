import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { PersonName } from '@/components/ui/PersonName';
import { LoadFailed, LoadingState } from '@/components/state';
import {
  peopleErrorText,
  usePeopleActions,
  useTrustReport,
  type MisValue,
  type TrustReport as TrustReportData,
} from '@/hooks/useControlRoomPeople';
import { DOWNLOADS_START_NOTE, roleLabel } from '@/lib/controlRoomTicks';
import { DATE_FORMATS, fmt } from '@/lib/format';

/**
 * THE WEEKLY TRUST REPORT (CR-3, D-155 / R1).
 *
 * "Who looked at farmers' phone numbers, who downloaded, who was turned away at the door, who has
 * not signed in." Every number is real or says why it is not counted (P4): a count the server could
 * not take exactly is "not measured" with its reason, never a cut number and never a zero. In
 * Release 1 nothing counts downloads yet, so that block says "Downloads start with field visits".
 * Each counted number opens the History lines it was counted from.
 */

const NOT_MEASURED_WORDS: Record<string, string> = {
  history_read_limit: 'Not counted: there were too many lines to count exactly.',
  downloads_start_with_field_visits: DOWNLOADS_START_NOTE,
};

function notMeasuredWords(reason: string | null): string {
  if (reason && NOT_MEASURED_WORDS[reason]) return NOT_MEASURED_WORDS[reason];
  return 'Not measured.';
}

/** A count that is a number (opening its History lines when it has some) or the reason it is not. */
function Count({ value, to }: { value: MisValue; to?: string }) {
  if (value.value === null || value.value === undefined) {
    return (
      <span data-not-measured={value.notMeasuredReason ?? 'unknown'} className="text-body text-text-2">
        {notMeasuredWords(value.notMeasuredReason)}
      </span>
    );
  }
  const text = fmt.num(value.value) ?? String(value.value);
  if (!to) return <span className="text-h3 font-bold text-text-1">{text}</span>;
  return (
    <Link to={to} className="text-h3 font-bold text-text-1 underline underline-offset-4">
      {text}
    </Link>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-2 first:border-t-0">
      <dt className="text-body text-text-2">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Block({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="glass-panel rounded-panel p-5">
      <h3 className="text-h3 font-semibold text-text-1">{title}</h3>
      {sub && <p className="mb-2 text-caption text-text-2">{sub}</p>}
      <dl className="mt-1">{children}</dl>
    </section>
  );
}

const HISTORY = '/people/history';

export function TrustReport() {
  const q = useTrustReport();
  const { keep } = usePeopleActions();

  if (q.isLoading) return <LoadingState label="Counting the week" height={160} />;
  if (q.isError || !q.data) {
    return <LoadFailed error={q.error} onRetry={() => void q.refetch()} what="the weekly trust report" />;
  }
  const r: TrustReportData = q.data;
  const countedAt = fmt.dateTime(r.countedAtUtc, DATE_FORMATS.usersLastLogin) ?? 'a time the server did not give';

  return (
    <section aria-labelledby="trust-report-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="trust-report-heading" className="text-h2 font-bold text-text-1">
          This week's trust report
        </h2>
        <p className="text-caption text-text-2">Counted {countedAt}. Phone and door numbers are for the last 7 days.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Block
          title="People with access"
          sub="The list as it is now. Every other number here is counted from History."
        >
          <Row label="People with access">
            <span className="text-h3 font-bold text-text-1">{fmt.num(r.peopleWithAccess) ?? r.peopleWithAccess}</span>
          </Row>
          {Object.entries(r.peopleByRole ?? {}).map(([role, n]) => (
            <Row key={role} label={roleLabel(role)}>
              <span className="text-body font-semibold text-text-1">{fmt.num(n) ?? n}</span>
            </Row>
          ))}
        </Block>

        <Block title="Farmers' phone numbers looked at">
          <Row label="Times looked at">
            <Count value={r.phoneLooks} to={`${HISTORY}?action=phones_shown&days=7`} />
          </Row>
          <Row label="Farms">
            <Count value={r.phoneFarms} />
          </Row>
          <Row label="People who looked">
            <Count value={r.phoneLookers} />
          </Row>
        </Block>

        <Block title="Downloads">
          <Row label="Downloads">
            <Count value={r.downloads} />
          </Row>
          <Row label="Farm rows downloaded">
            <Count value={r.downloadFarmRows} />
          </Row>
          <Row label="People who downloaded">
            <Count value={r.downloaders} />
          </Row>
        </Block>

        <Block title="Turned away at the door">
          <Row label="Tries by a number that is not approved">
            <Count value={r.refusedAtDoor} to={`${HISTORY}?action=door_refused&days=7`} />
          </Row>
        </Block>
      </div>

      <section className="glass-panel rounded-panel p-5">
        <h3 className="text-h3 font-semibold text-text-1">Not signed in for 30 days</h3>
        {r.notSignedInNotMeasuredReason ? (
          <p data-not-measured={r.notSignedInNotMeasuredReason} className="mt-1 text-body text-text-2">
            {notMeasuredWords(r.notSignedInNotMeasuredReason)}
          </p>
        ) : r.notSignedIn30Days.length === 0 ? (
          <p className="mt-1 text-body text-text-2">Everyone with access has signed in within 30 days, or was kept.</p>
        ) : (
          <>
            <p className="mb-2 text-caption text-text-2">
              Keep a person to leave them on the list; remove them from the list above if they no longer need access.
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {r.notSignedIn30Days.map((p) => (
                <li key={p.personId ?? p.phone} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="text-body text-text-1">
                    <PersonName name={p.displayName} fallback="Unnamed" /> · {roleLabel(p.startingRole)}
                  </span>
                  {p.personId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={keep.isPending}
                      onClick={() => keep.mutate(p.personId as string)}
                    >
                      Keep
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {keep.isError && (
              <p role="alert" className="mt-2 text-body text-text-1">
                {peopleErrorText(keep.error)}
              </p>
            )}
          </>
        )}
      </section>
    </section>
  );
}
