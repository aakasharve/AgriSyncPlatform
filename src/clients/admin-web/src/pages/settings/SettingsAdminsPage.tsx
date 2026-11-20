import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { LoadFailed, LoadingState } from '@/components/state';
import { useAdminScope } from '@/hooks/useAdminScope';
import {
  VISIT_TICKS,
  VISITS_LATER_NOTE,
  roleLabel,
  tickSelfDescription,
  tickLabel,
} from '@/lib/controlRoomTicks';

/**
 * MY ACCESS (CR-3, D-155) — the page that was "Settings".
 *
 * It says, in plain words, which parts of the control room the signed-in person can open. It reads
 * the answer the console already has (`GET /shramsafal/admin/me/scope`), so it costs no extra
 * request and cannot disagree with the menu, which is built from the same answer.
 *
 *   - The founder: "Founder: everything", and the way to People and access.
 *   - A team seat: the role they were started with and each part they hold, with what it opens.
 *   - Anyone else who got in (a farm organisation's seat): the count of parts, nothing invented.
 *
 * It is not a list of other people and has no controls: who has access is People and access, which
 * only the founder can open. The old Settings text about where admin access comes from is gone with
 * the password way it described.
 */
export default function SettingsAdminsPage() {
  const { isLoading, isError, error, scope, controlRoom, isPlatformAdmin } = useAdminScope();

  if (isLoading) return <LoadingState label="Loading your access" height={160} />;
  if (isError) {
    return <LoadFailed error={error} onRetry={() => window.location.reload()} what="your access" />;
  }

  const founder = isPlatformAdmin || controlRoom?.isFounder === true;
  const ticks = controlRoom?.ticks ?? [];
  const readable = scope?.modules.filter((m) => m.canRead).length ?? 0;

  return (
    <div className="flex max-w-[var(--text-measure)] flex-col gap-5">
      <div>
        <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
          <KeyRound size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
          My access
        </h1>
        <p className="mt-1 text-body text-text-2">What you can open in the control room.</p>
      </div>

      {founder ? (
        <section className="glass-panel flex flex-col gap-2 rounded-panel p-5">
          <p className="text-h3 font-bold text-text-1">Founder: everything</p>
          <p className="text-body text-text-2">
            Every part of the control room is open to you. You decide who else can sign in and what they can open.
          </p>
          <p>
            <Link to="/people" className="text-body font-semibold text-text-1 underline underline-offset-4">
              People and access
            </Link>
          </p>
        </section>
      ) : controlRoom ? (
        <section className="glass-panel flex flex-col gap-3 rounded-panel p-5">
          <p className="text-body text-text-2">
            Your role: <span className="font-semibold text-text-1">{roleLabel(controlRoom.startingRole)}</span>
          </p>
          <p className="text-body text-text-1">Home is open to you. These parts are open too:</p>
          {ticks.length === 0 ? (
            <p className="text-body text-text-2">No other part is open for you yet. Ask Akash if you need one.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ticks.map((key) => (
                <li key={key} data-tick={key} className="rounded-chip border border-control-edge px-3 py-2">
                  <span className="block text-body font-semibold text-text-1">{tickLabel(key)}</span>
                  <span className="block text-caption text-text-2">{tickSelfDescription(key)}</span>
                  {VISIT_TICKS.has(key) && (
                    <span data-visits-later="true" className="block text-caption font-semibold text-text-1">
                      {VISITS_LATER_NOTE}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-caption text-text-2">
            Anything not listed here is not open for you. Ask Akash if you need it.
          </p>
        </section>
      ) : (
        <section className="glass-panel rounded-panel p-5">
          <p className="text-body text-text-1">
            Your access comes from your organisation. {readable} {readable === 1 ? 'part is' : 'parts are'} open to
            you.
          </p>
        </section>
      )}
    </div>
  );
}
