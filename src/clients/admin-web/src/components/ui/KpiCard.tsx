import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { STATE_WORD, type HonestState } from '@/components/state/honestState';

/**
 * KpiCard — v3 `.as-kpi`, on the token layer.
 *
 * THE ONE RULE IN THIS FILE: honesty outranks tone.
 *
 * A tile whose `state` is anything other than `ok` renders grey and renders
 * an em dash, no matter what the caller asked for. A caller cannot paint an
 * unmeasured number green, because a green number is a claim and there is
 * nothing behind it. This is v3's one-line override (`app.js:363`) and it is
 * a behavioural rule, not styling — `KpiCard.honesty.test.tsx` holds it.
 *
 * Never a 0 for a missing reading. A zero and "we have no reading" are
 * different facts (CONTRACT.md §9.2).
 */

/**
 * The four causes a number can be absent for. One grey dash, four different
 * reasons — collapsing them into "no data" is the defect this replaces.
 *
 * Task 3 declared the vocabulary locally here with a note that Task 5 would
 * lift it into `components/state/` as the single source for tiles, table
 * cells and whole panels. Task 5 did, and this file now imports it — one
 * word list, not two that agree until someone edits one.
 *
 * The import is DEEP (`@/components/state/honestState`) rather than through
 * the barrel on purpose: `honestState.ts` has no JSX and no dependencies, so
 * a tile does not drag lucide, Button and the five state blocks into every
 * chunk that only needed four words.
 */
export type KpiState = 'ok' | HonestState;

/** CONTRACT.md §7.7. Grey is not a tone you choose — it is what you get. */
export type KpiTone = 'blue' | 'green' | 'red' | 'amber' | 'grey';

const TONE_TILE: Record<KpiTone, string> = {
  blue: 'bg-tint-blue',
  green: 'bg-tint-green',
  red: 'bg-tint-red',
  amber: 'bg-tint-amber',
  grey: 'bg-tint-grey',
};

const TONE_VALUE: Record<KpiTone, string> = {
  blue: 'text-blue',
  green: 'text-green',
  red: 'text-red',
  amber: 'text-amber',
  grey: 'text-text-3',
};

/**
 * THE LEADING EDGE (added 2026-09-02) — and why it cannot lie.
 *
 * It is driven by `resolvedTone`, the SAME value as the tile tint and the
 * figure colour, computed after the honesty override. So it is redundant by
 * construction: it can only ever repeat what the tile already says, and an
 * unmeasured tile gets `--color-edge-grey`, which §A.5 already defines as
 * "the leading edge of a row with no verdict". There is no code path that
 * gives a grey tile a coloured edge.
 *
 * That redundancy is the whole point of adding it. The founder's note was
 * that the console reads flat; a 6px saturated edge is weight, not
 * information, and weight is exactly what a tint at 4% saturation could not
 * supply on its own. §A.5's rule is that vivid fills are for bars, dots and
 * leading edges and never for text — this is a bar.
 */
const TONE_EDGE: Record<KpiTone, string> = {
  blue: 'bg-blue-vivid',
  green: 'bg-green-vivid',
  red: 'bg-red-vivid',
  amber: 'bg-amber-vivid',
  grey: 'bg-edge-grey',
};

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  /**
   * Defaults to `ok`. Anything else forces the tile grey and replaces the
   * value with an em dash — see the rule at the top of this file.
   */
  state?: KpiState;
  /** Ignored unless `state` is `ok`. Defaults to `blue`. */
  tone?: KpiTone;
  /** Where the number came from and how old it is (CONTRACT.md §9.1). */
  caption?: ReactNode;
  /** The sentence at the foot of the tile. */
  note?: ReactNode;
  delta?: string;
  deltaTrend?: 'up' | 'down' | 'flat';
  /**
   * @deprecated v3 KPI tiles carry no icon (CONTRACT.md §4.2). Still
   * rendered so the three unported screens that pass one do not lose it
   * silently; the prop and its call sites go in T19, T20 and T26.
   */
  icon?: ReactNode;
  /**
   * @deprecated Raw hex, supplied by the caller. Goes with `icon`.
   */
  iconColor?: string;
  className?: string;
}

export function KpiCard({
  label,
  value,
  state = 'ok',
  tone,
  caption,
  note,
  delta,
  deltaTrend = 'flat',
  icon,
  iconColor,
  className,
}: KpiCardProps) {
  // ── honesty wins ──────────────────────────────────────────────────────
  // The whole point of the redesign, in one line. Do not add a caller
  // escape hatch to it.
  const measured = state === 'ok';
  const resolvedTone: KpiTone = measured ? (tone ?? 'blue') : 'grey';

  return (
    <div
      data-tone={resolvedTone}
      data-state={state}
      data-print="panel"
      className={cn(
        'glass-tile relative flex min-w-0 flex-col overflow-hidden rounded-panel py-6 pr-6 pl-7',
        TONE_TILE[resolvedTone],
        className
      )}
    >
      {icon && (
        <div
          className="glass-quiet absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-chip"
          style={{ color: iconColor }}
        >
          {icon}
        </div>
      )}

      <div
        /* 52px bold, from the one type scale (§A.1 `--text-figure`), where it
           used to be 44 semibold written by hand. The figure is the thing a
           reader is on this tile for and it now outranks its own label by a
           factor of three rather than by nine pixels. It also clears WCAG's
           24px large-text threshold by a wide margin, which is what lets the
           four measured tone pairings stay exactly as they were. */
        className={cn(
          'text-figure font-bold [overflow-wrap:anywhere]',
          TONE_VALUE[resolvedTone]
        )}
      >
        {measured ? (
          value
        ) : (
          <>
            <span aria-hidden="true">&mdash;</span>
            <span className="sr-only">{STATE_WORD[state]}</span>
          </>
        )}
      </div>

      <div className="mt-2 pr-10 text-h3 font-semibold text-text-1">{label}</div>

      {caption && <div className="mt-1 text-caption text-text-2">{caption}</div>}

      {/* A delta is a verdict about a number. With no number there is no
          verdict, so an unmeasured tile shows none. */}
      {measured && delta && (
        <div
          className={cn(
            'mt-1.5 text-caption font-semibold',
            deltaTrend === 'up' && 'text-green',
            deltaTrend === 'down' && 'text-red',
            deltaTrend === 'flat' && 'text-text-2'
          )}
        >
          {delta}
        </div>
      )}

      {note && (
        <div className="mt-auto border-t border-line pt-3 text-caption text-text-2">{note}</div>
      )}

      {/* LAST, NOT FIRST, and that placement is load-bearing. Three screens'
          tests read the tile's figure as `tile.firstElementChild.textContent`
          (`OpsVoicePage.test.tsx:116` and its two siblings), so a decorative
          span in front of the value silently turns every figure assertion
          into an assertion about an empty string — eleven of them went red
          proving it. The bar is absolutely positioned, so DOM order costs it
          nothing, and the tests keep reading what they were written to read.
          Do not move it back up for tidiness. */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-1.5', TONE_EDGE[resolvedTone])}
      />
    </div>
  );
}
