import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import type { FarmerHealthTimelineDayDto } from '../farmer-health.types';
import { EmptyState } from './EmptyAndErrorStates';

/**
 * FarmerTimeline — Mode A Band 3 (UI brief §4 Band 3).
 *
 * 14-column × 6-row heat-grid:
 *   columns = days (oldest left, newest right)
 *   rows    = event_type from `timeline[]`
 *
 * Cell intensity scales with count (per-row max). Empty days render as
 * light gray (not white — must feel present even at zero, per UI brief).
 * Hover surfaces an exact tooltip via `<title>`.
 */

type EventKey =
  | 'closuresStarted' | 'closuresSubmitted' | 'proofAttached'
  | 'summariesViewed' | 'verifications' | 'errors';

interface RowMeta {
  key: EventKey;
  label: string;
  /** Hue for filled cells. Errors use the destructive token. */
  hue: string;
}

const ROWS: RowMeta[] = [
  { key: 'closuresStarted',   label: 'Started',     hue: '#7c3aed' },
  { key: 'closuresSubmitted', label: 'Submitted',   hue: '#52c0be' },
  { key: 'proofAttached',     label: 'Proof',       hue: '#0ea5e9' },
  { key: 'summariesViewed',   label: 'Summary',     hue: '#a16207' },
  { key: 'verifications',     label: 'Verifies',    hue: '#65a30d' },
  { key: 'errors',            label: 'Errors',      hue: '#dc2626' },
];

function intensityAlpha(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 0) return 0.15;
  // Ramp 0.18 → 0.95 across [1, max]; ensures even single events read.
  const t = Math.min(1, count / max);
  return 0.18 + 0.77 * t;
}

export interface FarmerTimelineProps {
  timeline: FarmerHealthTimelineDayDto[];
}

export function FarmerTimeline({ timeline }: FarmerTimelineProps) {
  const days = useMemo(() => timeline.slice(-14), [timeline]);

  const maxByRow = useMemo(() => {
    const max: Record<EventKey, number> = {
      closuresStarted: 0, closuresSubmitted: 0, proofAttached: 0,
      summariesViewed: 0, verifications: 0, errors: 0,
    };
    for (const d of days) {
      for (const row of ROWS) {
        if (d[row.key] > max[row.key]) max[row.key] = d[row.key];
      }
    }
    return max;
  }, [days]);

  if (days.length === 0) {
    return <EmptyState message="No telemetry yet for this farm." />;
  }

  return (
    <section className="glass-panel p-5" aria-label="14-day activity heatmap">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-extrabold text-text-primary">14-day activity</h3>
        <span className="text-[11px] text-text-muted">
          last {days.length} day{days.length === 1 ? '' : 's'} · darker = more events
        </span>
      </div>

      <div className="overflow-x-auto">
        <table
          className="border-separate text-[11px]"
          style={{ borderSpacing: '3px' }}
          aria-label="Activity heatmap by event type and day"
        >
          <thead>
            <tr>
              <th className="pr-2 text-left text-text-muted" />
              {days.map((d) => {
                let label = '—';
                try { label = format(parseISO(d.date), 'dd'); } catch { /* noop */ }
                return (
                  <th
                    key={d.date}
                    className="font-mono text-[10px] tabular-nums text-text-muted"
                    scope="col"
                    title={d.date}
                  >
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="pr-2 text-left text-[11px] font-semibold text-text-primary"
                >
                  {row.label}
                </th>
                {days.map((d) => {
                  const count = d[row.key];
                  const alpha = intensityAlpha(count, maxByRow[row.key]);
                  const bg = count > 0
                    ? `rgba(${hexToRgb(row.hue)}, ${alpha.toFixed(2)})`
                    : 'var(--color-surface-sidebar, #f3f4f6)';
                  const fg = count > 0 && alpha > 0.55 ? '#ffffff' : 'var(--color-text-muted, #6b7280)';
                  return (
                    <td key={`${row.key}-${d.date}`} className="p-0">
                      <div
                        className="grid h-7 w-7 place-items-center rounded font-mono text-[10px] font-bold tabular-nums"
                        style={{ background: bg, color: fg }}
                        title={`${row.label} on ${d.date}: ${count}`}
                      >
                        {count > 0 ? count : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="mt-3 text-[11px] text-text-muted">
        <summary className="cursor-pointer">Show data table</summary>
        <table className="mt-2 w-full font-mono text-[11px] tabular-nums">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-1 pr-3">Date</th>
              {ROWS.map((r) => <th key={r.key} className="py-1 pr-3 text-right">{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td className="py-0.5 pr-3">{d.date}</td>
                {ROWS.map((r) => (
                  <td key={r.key} className="py-0.5 pr-3 text-right">{d[r.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  const n = parseInt(v, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `${r}, ${g}, ${b}`;
}
