import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
 * Task 5 lifts this vocabulary into `components/state/` as the single source
 * for tiles, table cells and whole panels; this file imports it from there
 * once it exists. It is declared locally for now rather than guessed at in
 * advance, because Task 5 owns its shape.
 */
export type KpiState = 'ok' | 'unmeasured' | 'feed-down' | 'never' | 'unattributed';

/** CONTRACT.md §7.7. Grey is not a tone you choose — it is what you get. */
export type KpiTone = 'blue' | 'green' | 'red' | 'amber' | 'grey';

const STATE_WORD: Record<Exclude<KpiState, 'ok'>, string> = {
  unmeasured: 'not measured',
  'feed-down': 'feed down',
  never: 'never',
  unattributed: 'not attributable',
};

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
      className={cn(
        'relative flex min-w-0 flex-col rounded-panel px-5 py-4 shadow-raised',
        TONE_TILE[resolvedTone],
        className
      )}
    >
      {icon && (
        <div
          className="absolute right-3.5 top-3.5 grid h-[30px] w-[30px] place-items-center rounded-chip bg-page"
          style={{ color: iconColor }}
        >
          {icon}
        </div>
      )}

      <div
        className={cn(
          'text-[44px] font-semibold leading-[1.05] tracking-[-0.025em] [overflow-wrap:anywhere]',
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

      <div className="mt-2 pr-10 text-[15px] font-medium text-text-1">{label}</div>

      {caption && <div className="mt-1 text-[13px] text-text-2">{caption}</div>}

      {/* A delta is a verdict about a number. With no number there is no
          verdict, so an unmeasured tile shows none. */}
      {measured && delta && (
        <div
          className={cn(
            'mt-1 text-[13px] font-medium',
            deltaTrend === 'up' && 'text-green',
            deltaTrend === 'down' && 'text-red',
            deltaTrend === 'flat' && 'text-text-2'
          )}
        >
          {delta}
        </div>
      )}

      {note && (
        <div className="mt-auto border-t border-line pt-3 text-[13px] text-text-2">{note}</div>
      )}
    </div>
  );
}
