import { format, parseISO } from 'date-fns';
import { CloudOff, RefreshCcw } from 'lucide-react';
import type { FarmerHealthSyncStateDto } from '../farmer-health.types';

/**
 * SyncStateBlock — Mode A Band 5 (UI brief §4 Band 5; gated by ops:read).
 *
 * Shows the farmer's mobile-web sync posture: last successful push, queue
 * depth, recent failure count, and the 5 most recent error rows.
 *
 * Visually distinct per C8 — slate-tinted left border so admins know this
 * is privileged ops data and not part of the core farmer profile.
 */

function fmtTs(iso?: string | null): string {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'dd MMM, HH:mm'); }
  catch { return '—'; }
}

export interface SyncStateBlockProps {
  state?: FarmerHealthSyncStateDto | null;
}

export function SyncStateBlock({ state }: SyncStateBlockProps) {
  const lastErrors = state?.lastErrors ?? [];
  const pending = state?.pendingPushes ?? 0;
  const failed7d = state?.failedPushesLast7d ?? 0;

  return (
    <section
      className="glass-panel p-5"
      style={{ boxShadow: 'inset 4px 0 0 0 rgba(100, 116, 139, 0.55)' }}
      aria-label="Sync state (ops:read)"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-sidebar text-text-secondary">
          <RefreshCcw size={13} strokeWidth={2.4} />
        </span>
        <h3 className="text-base font-extrabold text-text-primary">Sync state</h3>
        <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-text-muted">
          ops:read
        </span>
      </div>

      {!state ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-surface-border px-3 py-2 text-[12px] text-text-muted">
          <CloudOff size={13} aria-hidden /> No sync activity recorded.
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 text-[12px]">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.08em] text-text-muted">Last sync</dt>
              <dd className="mt-0.5 font-mono text-[12px] font-bold tabular-nums text-text-primary">
                {fmtTs(state.lastSyncAt)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.08em] text-text-muted">Pending pushes</dt>
              <dd className={`mt-0.5 font-mono text-[12px] font-bold tabular-nums ${pending > 0 ? 'text-[#b45309]' : 'text-text-primary'}`}>
                {pending}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.08em] text-text-muted">Failed (7d)</dt>
              <dd className={`mt-0.5 font-mono text-[12px] font-bold tabular-nums ${failed7d > 0 ? 'text-danger' : 'text-text-primary'}`}>
                {failed7d}
              </dd>
            </div>
          </dl>

          {lastErrors.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
                Recent errors
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]" aria-label="Recent sync errors">
                  <thead>
                    <tr className="border-b border-row-divider text-left text-text-muted">
                      <th className="py-1.5 pr-3 font-extrabold">When</th>
                      <th className="py-1.5 pr-3 font-extrabold">Endpoint</th>
                      <th className="py-1.5 pr-3 text-right font-extrabold">Status</th>
                      <th className="py-1.5 pr-3 font-extrabold">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastErrors.slice(0, 5).map((e, i) => (
                      <tr key={`${e.ts}-${i}`} className="border-b border-row-divider last:border-0">
                        <td className="py-1.5 pr-3 font-mono tabular-nums text-text-muted">{fmtTs(e.ts)}</td>
                        <td className="py-1.5 pr-3 font-mono text-text-primary">{e.endpoint}</td>
                        <td className="py-1.5 pr-3 text-right font-mono font-bold tabular-nums text-danger">{e.status}</td>
                        <td className="py-1.5 pr-3 break-words text-text-secondary">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
