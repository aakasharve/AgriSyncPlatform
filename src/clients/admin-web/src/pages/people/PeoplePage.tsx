import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PersonName } from '@/components/ui/PersonName';
import { LoadFailed, LoadingState } from '@/components/state';
import {
  peopleErrorText,
  usePeople,
  usePeopleActions,
  type Person,
} from '@/hooks/useControlRoomPeople';
import { roleLabel } from '@/lib/controlRoomTicks';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { PersonPanel } from './PersonPanel';
import { TrustReport } from './TrustReport';

type Panel = { mode: 'add' } | { mode: 'edit'; person: Person } | null;

/**
 * PEOPLE AND ACCESS (CR-3, D-155): the founder's own page. Who may sign in, what each person may
 * open, what was done (History) and the weekly trust report. The route is wrapped in `FounderOnly`
 * and the server answers only the founder, so a team seat never reaches either.
 */
export default function PeoplePage() {
  const people = usePeople();
  const { remove } = usePeopleActions();
  const [panel, setPanel] = useState<Panel>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            People and access
          </h1>
          <ul className="mt-1 max-w-[var(--text-measure)] list-none space-y-1 text-body text-text-2">
            <li>Home is open to everyone you approve. People and access is yours only and has no tick.</li>
            <li>
              Orange ticks are actions with farmers' personal data. Each use of them is written in History with the
              person's name and the time.
            </li>
            <li>History cannot be edited or deleted, by anyone.</li>
          </ul>
        </div>
        <div className="flex gap-2">
          <Link to="/people/history">
            <Button variant="outline">History</Button>
          </Link>
          <Button onClick={() => setPanel({ mode: 'add' })} disabled={!people.data}>
            Add a person
          </Button>
        </div>
      </div>

      {people.isLoading && <LoadingState label="Loading people" height={160} />}
      {(people.isError || (!people.isLoading && !people.data)) && (
        <LoadFailed error={people.error} onRetry={() => void people.refetch()} what="the list of people" />
      )}

      {people.data && panel && (
        <PersonPanel
          key={panel.mode === 'edit' ? panel.person.personId : 'add'}
          mode={panel.mode}
          person={panel.mode === 'edit' ? panel.person : undefined}
          answer={people.data}
          onClose={() => setPanel(null)}
        />
      )}

      {people.data && (
        <section aria-label="People with access" className="glass-panel overflow-x-auto rounded-panel">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-caption text-text-2">
                <th scope="col" className="px-4 py-3 font-semibold">Person</th>
                <th scope="col" className="px-4 py-3 font-semibold">Role</th>
                <th scope="col" className="px-4 py-3 font-semibold">Account</th>
                <th scope="col" className="px-4 py-3 font-semibold">Last signed in</th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {people.data.people.map((p) => {
                const key = p.personId ?? `founder-${p.phone}`;
                return (
                  <tr key={key} data-person={p.isFounder ? 'founder' : p.personId} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <span className="block text-body font-semibold text-text-1">
                        <PersonName name={p.displayName} fallback="Unnamed" />
                      </span>
                      <span className="block tabular-nums text-caption text-text-2">{p.phone}</span>
                    </td>
                    <td className="px-4 py-3 text-body text-text-1">
                      {p.isFounder ? 'Founder: everything' : roleLabel(p.startingRole)}
                      {!p.isFounder && (
                        <span className="block text-caption text-text-2">
                          {p.ticks.length} {p.ticks.length === 1 ? 'part' : 'parts'} ticked
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-body text-text-2">
                      {p.boundAccountName ? (
                        <PersonName name={p.boundAccountName} fallback="An account" />
                      ) : (
                        'No account yet'
                      )}
                    </td>
                    <td className="px-4 py-3 text-body text-text-2">
                      {p.lastSignedInUtc
                        ? fmt.dateTime(p.lastSignedInUtc, DATE_FORMATS.usersLastLogin)
                        : 'No sign-in here yet'}
                    </td>
                    <td className="px-4 py-3">
                      {p.isFounder || !p.personId ? null : confirming === p.personId ? (
                        <div role="group" aria-label={`Remove ${p.displayName}`} className="flex max-w-xs flex-col gap-2">
                          <p className="text-body text-text-1">
                            Remove {p.displayName}? They will no longer be able to sign in. This is written in History.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={remove.isPending}
                              onClick={() =>
                                remove.mutate(p.personId as string, {
                                  onSettled: () => setConfirming(null),
                                })
                              }
                            >
                              Yes, remove
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setPanel({ mode: 'edit', person: p })}>
                            Change
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setConfirming(p.personId)}>
                            Remove
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {remove.isError && (
            <p role="alert" className="px-4 pb-3 text-body text-text-1">
              {peopleErrorText(remove.error)}
            </p>
          )}
        </section>
      )}

      <TrustReport />
    </div>
  );
}
