import { useState } from 'react';
import type { Bucket, FarmerHealthScoreBreakdownDto } from '../farmer-health.types';

/**
 * DwcScoreCard — Mode A Band 2 (the marquee element, UI brief §4 Band 2).
 *
 * - Big total number, DM Sans 64px, tabular nums.
 * - Six horizontal mini-bars, one per pillar, colored by ratio (per C7
 *   ramp — never bright green; teal stands in for "healthy enough").
 * - Each pillar row clickable → expands a single-line explanation.
 *
 * Pillar weights (DWC v2 plan §3 / ADR-2026-05-04):
 *   triggerFit 10, actionSimplicity 20, proof 25, reward 10,
 *   investment 10, repeat 25  →  total 100.
 */

type PillarKey =
  | 'triggerFit' | 'actionSimplicity' | 'proof'
  | 'reward' | 'investment' | 'repeat';

interface PillarMeta {
  label: string;
  max: number;
  /** Single-line explanation surfaced on row expand. */
  explain: string;
}

const PILLARS: Record<PillarKey, PillarMeta> = {
  triggerFit: {
    label: 'Trigger fit', max: 10,
    explain: 'How often the right reminder arrived at the right time. Full credit when nudges land before the farmer needs them.',
  },
  actionSimplicity: {
    label: 'Action simplicity', max: 20,
    explain: 'Median closure took N seconds; full credit at ≤ 30s end-to-end.',
  },
  proof: {
    label: 'Proof', max: 25,
    explain: 'Share of closures with attached evidence (photo / receipt / verification). Full credit at ≥ 80% proof rate.',
  },
  reward: {
    label: 'Reward', max: 10,
    explain: 'Did the farmer see the closure summary or weekly digest? Reward signal ≈ engagement with own outcomes.',
  },
  investment: {
    label: 'Investment', max: 10,
    explain: 'Voluntary log depth — notes, voice clips, optional fields filled. Signals that the farmer chose to do more than the minimum.',
  },
  repeat: {
    label: 'Repeat', max: 25,
    explain: 'Consecutive-day closure streak. Highest weight pillar — habit formation is the product.',
  },
};

const PILLAR_ORDER: PillarKey[] = [
  'triggerFit', 'actionSimplicity', 'proof', 'reward', 'investment', 'repeat',
];

const BUCKET_TONE: Record<Bucket, { bg: string; fg: string; label: string }> = {
  intervention: { bg: 'rgba(220,38,38,0.14)', fg: '#dc2626', label: 'Intervention' },
  watchlist:    { bg: 'rgba(245,158,11,0.18)', fg: '#b45309', label: 'Watchlist' },
  healthy:      { bg: 'rgba(82,192,190,0.16)', fg: '#0e7d7b', label: 'Healthy' },
};

function fillFor(ratio: number): string {
  if (ratio < 0.5) return '#dc2626';
  if (ratio < 0.75) return '#f59e0b';
  return '#52c0be'; // never bright green per C7
}

export interface DwcScoreCardProps {
  score: FarmerHealthScoreBreakdownDto;
}

export function DwcScoreCard({ score }: DwcScoreCardProps) {
  const [expanded, setExpanded] = useState<PillarKey | null>(null);
  const tone = BUCKET_TONE[score.bucket];

  return (
    <section className="glass-panel p-5" aria-label="DWC v2 score breakdown">
      <div className="flex items-start gap-6">
        <div className="flex flex-col items-start">
          <div
            className="font-extrabold tabular-nums leading-none text-text-primary"
            style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 64 }}
            aria-label={`Total DWC score ${score.total} of 100`}
          >
            {score.total}
            <span className="ml-1 text-2xl text-text-muted">/100</span>
          </div>
          <div
            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em]"
            style={{ background: tone.bg, color: tone.fg }}
          >
            {tone.label}
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-text-muted tabular-nums">
            week of {score.weekStart}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2.5" role="list" aria-label="Pillar breakdown">
          {PILLAR_ORDER.map((key) => {
            const meta = PILLARS[key];
            const value = score.pillars[key];
            const ratio = meta.max > 0 ? Math.min(1, Math.max(0, value / meta.max)) : 0;
            const isOpen = expanded === key;
            return (
              <div key={key} role="listitem" className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : key)}
                  aria-expanded={isOpen}
                  aria-controls={`pillar-explain-${key}`}
                  className="flex items-center gap-3 rounded-sm px-1 -mx-1 py-0.5 text-left hover:bg-surface-sidebar focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
                >
                  <span className="w-32 truncate text-[12px] font-semibold text-text-primary">
                    {meta.label}
                  </span>
                  <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-surface-sidebar">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{ width: `${ratio * 100}%`, background: fillFor(ratio) }}
                    />
                  </span>
                  <span className="w-16 text-right font-mono text-[11px] font-bold tabular-nums text-text-primary">
                    {value}<span className="text-text-muted"> / {meta.max}</span>
                  </span>
                </button>
                {isOpen && (
                  <p
                    id={`pillar-explain-${key}`}
                    className="ml-32 pl-3 text-[11px] leading-snug text-text-muted"
                  >
                    {meta.explain}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
