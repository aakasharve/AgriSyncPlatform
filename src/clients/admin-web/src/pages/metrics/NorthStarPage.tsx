import { Star } from 'lucide-react';
import { NotBuiltYet } from '@/components/state';

/**
 * WVFD — the North Star number (`/metrics/nsm`), every part an idea (amendment B24).
 *
 * Weekly Verified Farm-Days used to be drawn here from `/admin/metrics/wvfd`,
 * a nightly view that is empty or wrong on this database. Under the founder's
 * rule (B23) a number that is not real is parked as an idea: it stays on its
 * page, says "Not built yet" with its two lines, and shows no number, no zero,
 * no chart and no empty list. It is built later, at request time, on real data.
 *
 * So this page makes NO request: not to `/admin/metrics/wvfd`, not to any
 * other feed. An empty answer from that feed must never be drawn as "none".
 *
 * The goal (W5) is not a data problem: the 4.5 that used to sit here was a code
 * constant nobody chose. It reads "Goal not set yet" until the founder sets it
 * (D-151 b), and no share of a goal is shown.
 */
const PARTS: { metric: string; word?: string }[] = [
  { metric: 'wvfd-average' },
  { metric: 'wvfd-change' },
  { metric: 'wvfd-farms' },
  { metric: 'wvfd-weeks' },
  { metric: 'wvfd-goal', word: 'Goal not set yet' },
  { metric: 'wvfd-tiers' },
  { metric: 'wvfd-farm-list' },
];

export default function NorthStarPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
          <Star size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
          North Star &middot; WVFD
        </h1>
        <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
          <b>Weekly Verified Farm-Days</b> is the one number this product is steered by. None of its
          parts is counted yet, so each one waits below with what it will show and why it is here.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PARTS.map((p) => (
          <NotBuiltYet key={p.metric} metric={p.metric} word={p.word} />
        ))}
      </div>
    </div>
  );
}
