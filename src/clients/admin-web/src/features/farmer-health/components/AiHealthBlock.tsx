import { Sparkles } from 'lucide-react';
import type { FarmerHealthAiHealthDto } from '../farmer-health.types';

/**
 * AiHealthBlock — Mode A Band 5 (UI brief §4 Band 5; gated by ops:read).
 *
 * Surfaces the farmer's 14-day AI invocation health:
 *   - voice parse success rate
 *   - receipt parse success rate
 *   - total invocations
 *
 * Visually distinct per C8 — slate-tinted left border, matching
 * SyncStateBlock so the two ops sections read as a pair.
 */

function pct(rate?: number): { label: string; tone: 'good' | 'warn' | 'bad' | 'none' } {
  if (rate === undefined || rate === null || Number.isNaN(rate)) {
    return { label: '—', tone: 'none' };
  }
  const r = Math.max(0, Math.min(1, rate));
  const label = `${(r * 100).toFixed(0)}%`;
  if (r >= 0.9) return { label, tone: 'good' };
  if (r >= 0.7) return { label, tone: 'warn' };
  return { label, tone: 'bad' };
}

const TONE_COLOR: Record<'good' | 'warn' | 'bad' | 'none', string> = {
  good: '#0e7d7b',  // teal — never bright green per C7
  warn: '#b45309',
  bad:  '#dc2626',
  none: 'var(--color-text-muted, #6b7280)',
};

export interface AiHealthBlockProps {
  health?: FarmerHealthAiHealthDto | null;
}

export function AiHealthBlock({ health }: AiHealthBlockProps) {
  const voice = pct(health?.voiceParseSuccessRate14d);
  const receipt = pct(health?.receiptParseSuccessRate14d);
  const invocations = health?.invocationCount14d ?? 0;

  return (
    <section
      className="glass-panel p-5"
      style={{ boxShadow: 'inset 4px 0 0 0 rgba(100, 116, 139, 0.55)' }}
      aria-label="AI health (ops:read)"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-sidebar text-text-secondary">
          <Sparkles size={13} strokeWidth={2.4} />
        </span>
        <h3 className="text-base font-extrabold text-text-primary">AI health (14d)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-text-muted">
          ops:read
        </span>
      </div>

      {!health ? (
        <div className="rounded-md border border-dashed border-surface-border px-3 py-2 text-[12px] text-text-muted">
          No AI invocations recorded for this farm in the last 14 days.
        </div>
      ) : (
        <dl className="grid grid-cols-3 gap-3 text-[12px]">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.08em] text-text-muted">Voice parse</dt>
            <dd
              className="mt-0.5 font-mono text-[18px] font-extrabold tabular-nums"
              style={{ color: TONE_COLOR[voice.tone] }}
              aria-label={`Voice parse success rate ${voice.label}`}
            >
              {voice.label}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.08em] text-text-muted">Receipt parse</dt>
            <dd
              className="mt-0.5 font-mono text-[18px] font-extrabold tabular-nums"
              style={{ color: TONE_COLOR[receipt.tone] }}
              aria-label={`Receipt parse success rate ${receipt.label}`}
            >
              {receipt.label}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.08em] text-text-muted">Invocations</dt>
            <dd className="mt-0.5 font-mono text-[18px] font-extrabold tabular-nums text-text-primary">
              {invocations}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
