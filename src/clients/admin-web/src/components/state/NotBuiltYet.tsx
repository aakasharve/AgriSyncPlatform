import { cn } from '@/lib/utils';
import { metricLine } from '@/app/metricLines';

/**
 * NotBuiltYet — a number the console has an idea for but does not count yet.
 *
 * Amendment B24 (founder's rule B23, 2026-11-17): an empty, placeholder or
 * not-real number is an IDEA parked on its page for reference, and it is built
 * later on real data. Until then it stays visible and says so. It is NOT the
 * same thing as "Not measured yet" (a Company MIS item the server does not
 * count): "Not built yet" is only for the older-page ideas.
 *
 * What this panel prints is exactly four things: the label, the words "Not
 * built yet", the `what` line and the `why` line (verbatim from metricLines).
 * Never a number, never a zero, never a dash standing for a value, never a
 * chart, never an empty list, never "none" or "nobody". Because it takes only
 * a metric key, there is no way to hand it a value from a feed.
 *
 * `word` exists for one idea only: the WVFD goal (W5) reads "Goal not set
 * yet", because nobody has chosen the goal (D-151 b); the 4.5 in the old code
 * was a constant nobody chose.
 */
export interface NotBuiltYetProps {
  /** Key in `metricLines.ts`. */
  metric: string;
  /** Replaces "Not built yet" (only the WVFD goal does). */
  word?: string;
  className?: string;
}

export function NotBuiltYet({ metric, word = 'Not built yet', className }: NotBuiltYetProps) {
  const line = metricLine(metric);
  return (
    <section
      data-state="not-built-yet"
      data-metric={line.key}
      aria-label={line.label}
      className={cn('rounded-panel bg-tint-grey px-5 py-4 text-left', className)}
    >
      <h3 className="text-h3 font-semibold text-text-1">{line.label}</h3>
      <p className="mt-0.5 text-caption font-semibold text-text-3">{word}</p>
      <p className="mt-2 max-w-[var(--text-measure)] text-body text-text-2" data-metric-line="what">
        {line.what}
      </p>
      <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-3" data-metric-line="why">
        {line.why}
      </p>
    </section>
  );
}

/**
 * The mark that sits in a column header (or on a disabled filter) when the
 * column is an idea. The cells under it print no value; the column's two lines
 * sit under the table (use `NotBuiltYetLines`).
 */
export function NotBuiltYetMark({ className }: { className?: string }) {
  return (
    <span
      data-state="not-built-yet-mark"
      className={cn('ml-1 inline-block text-caption font-normal text-text-3', className)}
    >
      Not built yet
    </span>
  );
}

/** The two lines of one idea, without the panel: used under a table whose column is the idea. */
export function NotBuiltYetLines({ metric, className }: { metric: string; className?: string }) {
  const line = metricLine(metric);
  return (
    <div data-metric={line.key} className={cn('text-caption text-text-2', className)}>
      <p>
        <span className="font-semibold text-text-1">{line.label}: </span>
        <span data-metric-line="what">{line.what}</span>
      </p>
      <p className="text-text-3" data-metric-line="why">
        {line.why}
      </p>
    </div>
  );
}

/** The two lines of a number that IS real, shown beside it (B21). */
export function MetricLines({ metric, className }: { metric: string; className?: string }) {
  const line = metricLine(metric);
  return (
    <div data-metric={line.key} className={cn('text-caption', className)}>
      <p className="text-text-2" data-metric-line="what">
        {line.what}
      </p>
      <p className="text-text-3" data-metric-line="why">
        {line.why}
      </p>
    </div>
  );
}
