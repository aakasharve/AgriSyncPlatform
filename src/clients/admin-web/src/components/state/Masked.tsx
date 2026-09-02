import { cn } from '@/lib/utils';
import { NotMeasured } from './NotMeasured';
import { maskState } from './redaction';

/**
 * Masked — a redacted or partly-hidden value, rendered as a STATE rather
 * than as text (Preservation Register A14, B16).
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * A value the caller may not see is not missing data and it is not a string.
 * It is a permission fact, and it renders the same way on every surface so
 * that no screen invents its own handling.
 *
 * Three inputs, three different truths, and they must not be collapsed:
 *
 *   `**redacted**`  the whole value is withheld  → the FALLBACK is shown
 *                                                  (a farm id, an account id)
 *                                                  and the marker never is.
 *   `98******12`    partly withheld              → shown AS SENT. An operator
 *                                                  can still match the last
 *                                                  two digits on a call, so
 *                                                  swallowing it would destroy
 *                                                  a usable fact.
 *   null / ''       nothing was measured         → delegated to NotMeasured,
 *                                                  which is the only component
 *                                                  allowed to print a missing
 *                                                  value.
 *
 * ── The bug this closes ───────────────────────────────────────────────────
 * `FarmerHealthDrilldown.tsx:55` reads
 *   `farmer?.farmerName?.trim() || (farmId ?? 'Farmer Health')`
 * which falls back only when the name is EMPTY. A redacted name is a
 * non-empty six-character string, so today it prints `**redacted**` into the
 * page title. Routing that title through `Masked` with `fallback={farmId}` is
 * what makes the fallback fire on the case it was written for.
 *
 * The v3 prototype cannot show this: it was drawn against full-PII sample
 * data and prints whole phone numbers on five screens.
 */
export interface MaskedProps {
  value: string | null | undefined;
  /** What to show instead when the value is fully redacted — a farm id, an
   *  account id. Anything that identifies the row without naming the person. */
  fallback?: string;
  className?: string;
}

export function Masked({ value, fallback, className }: MaskedProps) {
  const state = maskState(value);

  if (state === 'redacted') {
    return fallback ? (
      <span data-masked="redacted" className={className}>
        {fallback}
      </span>
    ) : (
      /* No fallback and nothing showable. It is still not a blank: the reader
         is told the value exists and is hidden from them, which is a
         different fact from "there is no value". */
      <span
        data-masked="redacted"
        title="Hidden — your role does not include permission to see this value."
        className={cn('inline-block align-top text-text-3', className)}
      >
        <span aria-hidden="true" className="text-[17px] leading-none">
          &mdash;
        </span>
        <span className="block text-caption text-text-3">hidden</span>
      </span>
    );
  }

  if (value === null || value === undefined || value.trim() === '') {
    return fallback ? (
      <span data-masked="none" className={className}>
        {fallback}
      </span>
    ) : (
      <NotMeasured state="unmeasured" className={className} />
    );
  }

  return (
    <span
      data-masked={state}
      title={state === 'partial' ? 'Partly hidden by the server for your role.' : undefined}
      className={className}
    >
      {value}
    </span>
  );
}
