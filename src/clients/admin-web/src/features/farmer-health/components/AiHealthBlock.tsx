import { NotMeasured, NotMeasuredPanel } from '@/components/state';
import { fmt, rate01 } from '@/lib/format';
import { aiRatesAreReadings } from '../drilldown';
import type { FarmerHealthAiHealthDto } from '../farmer-health.types';
import { OpsPanel } from './OpsPanel';

/**
 * BAND 5b — AI invocation health over fourteen days. PRIVILEGED: the server
 * only fills this block for a caller holding `ops.voice`
 * (`AdminFarmerHealthRepository.cs:83-85`).
 *
 * ── 🔴 THE FABRICATION HERE POINTS THE OTHER WAY FROM A38 ────────────────
 * A38 registers the rule "null, NaN or undefined becomes an em dash; clamp
 * 0..1; never a fabricated 0%". That rule is kept — `rate01` is the same
 * sanitisation, lifted into `@/lib/format` by Task 4 and imported rather than
 * re-implemented.
 *
 * But the fabrication this block actually ships is a **100%**, and it is
 * worse, because a perfect score is the reading nobody questions:
 *
 *   `GetAiHealthAsync` returns `(1m, 1m, 0)` from its `catch` (`:423`), and
 *   its SQL COALESCEs each ratio to `1.0` when the denominator is zero
 *   (`:400,:406`).
 *
 * So "voice parse 100%" is what a broken query looks like, what an empty
 * fourteen-day window looks like, and what a genuinely flawless farm looks
 * like — three different facts, one figure. With no invocations there is
 * nothing to take a ratio OF, so neither rate is a reading and neither is
 * drawn. `aiRatesAreReadings` is the single predicate that decides it.
 *
 * What survives even when there ARE invocations: `invocationCount14d` counts
 * every `ai.invocation` event, while each rate's denominator counts only the
 * events tagged with that provider. A farm with receipt invocations and no
 * voice invocations therefore still shows voice at 100%. That cannot be
 * separated from the client, and it is said in words under the figures rather
 * than left for a reader to discover.
 *
 * C7 is the tone ramp: a good rate tops out at `--color-pillar-good`, the
 * teal, and never reaches a bright green. C8 — the slate inset edge — belongs
 * to `OpsPanel`.
 */

type Tone = 'good' | 'warn' | 'bad';

function toneFor(rate: number): Tone {
  if (rate >= 0.9) return 'good';
  if (rate >= 0.7) return 'warn';
  return 'bad';
}

/* Text colour, so the C7 teal — never a bright green — is what a healthy
   reading reaches. Tokens only; the values live in `globals.css`. */
const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--color-pillar-good)',
  warn: 'var(--color-amber)',
  bad: 'var(--color-red)',
};

export interface AiHealthBlockProps {
  health?: FarmerHealthAiHealthDto | null;
}

export function AiHealthBlock({ health }: AiHealthBlockProps) {
  if (!health) {
    return (
      <OpsPanel title="AI health (14 days)" grant="ops.voice">
        <NotMeasuredPanel
          title="No AI health block was sent for this farm"
          why="Your role includes the grant this block needs, so an absent block is the server declining to assemble it rather than a farm with no AI activity."
        />
      </OpsPanel>
    );
  }

  const measured = aiRatesAreReadings(health);
  const invocations = fmt.num(health.invocationCount14d);

  return (
    <OpsPanel title="AI health (14 days)" grant="ops.voice">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Rate label="Voice parse" rate={health.voiceParseSuccessRate14d} measured={measured} />
        <Rate label="Receipt parse" rate={health.receiptParseSuccessRate14d} measured={measured} />
        <div>
          <dt className="text-caption text-text-2">Invocations</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular-nums text-text-1">
            {invocations === null ? (
              <NotMeasured state="unmeasured" why="The invocation count did not arrive as a number." />
            ) : (
              invocations
            )}
          </dd>
          <p className="mt-0.5 text-caption text-text-3">
            Every <code>ai.invocation</code> event on this farm in fourteen days.
          </p>
        </div>
      </dl>

      <p className="mt-3 text-caption text-text-3">
        {measured ? (
          <>
            Each rate divides successes by invocations <b>of that provider</b>, while the count
            beside them is every provider. A farm with receipt invocations and no voice ones still
            shows voice at 100 per cent, because the server substitutes 1.0 for an empty
            denominator — so a rate of exactly 100 per cent is worth checking against the count
            before it is quoted.
          </>
        ) : (
          <>
            Nothing was invoked in the window, so there is no ratio to take. The server would send
            100 per cent for both rates here — it substitutes 1.0 for an empty denominator, and
            answers a failed query with the same pair — which is why neither is drawn.
          </>
        )}
      </p>
    </OpsPanel>
  );
}

function Rate({ label, rate, measured }: { label: string; rate: number; measured: boolean }) {
  const clamped = rate01(rate);
  const printed = measured ? fmt.ratePct(rate) : null;

  return (
    <div>
      <dt className="text-caption text-text-2">{label}</dt>
      <dd
        data-rate={label}
        className="mt-0.5 text-[18px] font-semibold tabular-nums"
        style={printed !== null && clamped !== null ? { color: TONE_COLOR[toneFor(clamped)] } : undefined}
      >
        {printed === null ? (
          <NotMeasured
            state={measured ? 'unmeasured' : 'never'}
            why={
              measured
                ? 'This rate did not arrive as a number.'
                : 'There were no AI invocations in the window, so there is no ratio to take. The 100% the server sends here is a substitution, not a measurement.'
            }
          />
        ) : (
          printed
        )}
      </dd>
    </div>
  );
}
