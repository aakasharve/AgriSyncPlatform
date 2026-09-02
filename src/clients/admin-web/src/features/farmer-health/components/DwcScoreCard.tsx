import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { GapBar } from '@/components/data';
import { NotMeasured, NotMeasuredPanel } from '@/components/state';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  PILLARS,
  SCORE_MAX,
  SCORE_REACHABLE,
  INTERVENTION_AT,
  WATCHLIST_TO,
  type PillarMeta,
} from '../cohort';
import {
  BUCKET,
  FLAG_NOTICE,
  SUSPICION_PENALTY,
  pillarSum,
  scoreIsReadable,
} from '../drilldown';
import type { FarmerHealthPillarsDto, FarmerHealthScoreBreakdownDto } from '../farmer-health.types';

/**
 * BAND 2 — the marquee element, and the one figure on this screen a reader
 * will quote in a meeting.
 *
 * Preserved from the live card: the 64px total in DM Sans with tabular
 * figures, the band badge, and six horizontal pillar bars at their UNEQUAL
 * maxes, each row a button that expands one line of explanation
 * (`aria-expanded` / `aria-controls`, one open at a time).
 *
 * Four things changed, and every one of them is a fact about the server
 * rather than a preference about the design.
 *
 * ── 1. IT REFUSES TO DRAW A SCORE THE SERVER DID NOT MEASURE ─────────────
 * `EmptyScore()` (`AdminFarmerHealthRepository.cs:203`) answers a missing row
 * — and its own swallowed exception — with `total 0`, `bucket
 * "intervention"`, `flag "insufficient_data"`, six zero pillars and a week
 * boundary set to TODAY. Drawn literally that is a 64px `0` under a red
 * INTERVENTION badge, which reads as a finding about a farmer and is an
 * artefact of an unpopulated view. `flag === 'insufficient_data'` is the one
 * honest signal in that row, and it is the branch this card takes first.
 *
 * ── 2. THE SIX BARS DO NOT ADD UP TO THE TOTAL WHEN A FARM IS FLAGGED ────
 * The matview subtracts 30 for `suspicious` BEFORE deciding the band. Six
 * bars summing to 51 beside a total of 21 is not a rendering bug and a reader
 * cannot know that; the card states the subtraction and shows the sum.
 *
 * ── 3. INVESTMENT IS NOT A BAR ───────────────────────────────────────────
 * Its CTE is a documented placeholder returning 0.0 for every farm, so
 * `0.0 / 10` in a red bar is an unbuilt feature drawn as a failing pillar.
 * It renders as a hatched gap with the reason attached — the same treatment
 * the cohort heatmap gives it, from the same source (`cohort.ts` PILLARS), so
 * the two screens cannot come to disagree about it.
 *
 * ── 4. THE MAXIMUM IS 90 ─────────────────────────────────────────────────
 * Five measurable pillars sum to 90, the bands are absolute, and nothing was
 * adjusted when the sixth stopped being computed. The card says so under the
 * total rather than leaving `/100` to imply a reachable ceiling.
 *
 * C7 lives in `fillFor`: the ramp tops out at `--color-pillar-good` and never
 * reaches a bright green, so a good reading can never be mistaken for a
 * celebration. Token only — the value has ONE home and it is `globals.css`.
 */

type PillarKey = keyof FarmerHealthPillarsDto;

/* Bar fills, so the vivid tokens stay away from text (CONTRACT.md §7.7). The
   top of the ramp is C7's teal, never a green. Do not raise it. */
function fillFor(ratio: number): string {
  if (ratio < 0.5) return 'var(--color-red-vivid)';
  if (ratio < 0.75) return 'var(--color-amber-vivid)';
  return 'var(--color-pillar-good)';
}

export interface DwcScoreCardProps {
  score: FarmerHealthScoreBreakdownDto;
}

export function DwcScoreCard({ score }: DwcScoreCardProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const week = fmt.date(score.weekStart, DATE_FORMATS.dwcWeek);

  /* ── the branch that keeps a fabricated row off the screen ───────────── */
  if (!scoreIsReadable(score)) {
    const notice = FLAG_NOTICE.insufficient_data;
    return (
      <section data-band="score" aria-label="DWC v2 score breakdown">
        <NotMeasuredPanel
          title={notice.title}
          why={
            <>
              <p>{notice.body}</p>
              <p className="mt-2">
                The score view behind this figure is created <code>WITH NO DATA</code> and the
                nightly job refreshes <code>CONCURRENTLY</code>, which cannot populate an empty
                view; the one-time repair is deployment task <b>D3</b>, recorded as not live. Until
                it runs, every farm reaches this branch and none of them is evidence about a farmer.
              </p>
            </>
          }
        />
      </section>
    );
  }

  const sum = pillarSum(score);
  const penalised = score.flag === 'suspicious';
  const band = BUCKET[score.bucket];

  return (
    <section
      data-band="score"
      className="rounded-panel bg-page p-5 shadow-surface"
      aria-label="DWC v2 score breakdown"
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {/* ── the total ─────────────────────────────────────────────────── */}
        <div className="flex shrink-0 flex-col items-start">
          <div
            data-total=""
            className="font-extrabold tabular-nums leading-none text-text-1"
            style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 64 }}
            aria-label={`Total DWC score ${score.total} of ${SCORE_MAX}`}
          >
            {fmt.num(score.total)}
            <span className="ml-1 text-2xl text-text-3">/{fmt.num(SCORE_MAX)}</span>
          </div>

          <span
            data-bucket={score.bucket}
            className={cn(
              'mt-2 inline-flex items-center rounded-chip px-2 py-0.5 text-caption font-semibold',
              band.className
            )}
          >
            {band.label}
          </span>

          <p className="mt-2 max-w-[15rem] text-caption text-text-3">
            {week === null ? (
              <>
                The week this score belongs to did not parse, so this figure cannot be dated.
              </>
            ) : (
              <>
                Week of <span className="tabular-nums">{week}</span> — the most recent scored week
                on the view, which may not be the current one.
              </>
            )}
          </p>

          <p className="mt-2 max-w-[15rem] text-caption text-text-3">
            One of the six pillars has never been computed, so the highest score any farm can
            currently reach is <b>{fmt.num(SCORE_REACHABLE)}</b>, not {fmt.num(SCORE_MAX)}. The
            bands are absolute — <b>{fmt.num(INTERVENTION_AT)} or below</b> is intervention,{' '}
            <b>{fmt.num(WATCHLIST_TO)}</b> is the top of the watchlist — and they were not adjusted
            for it.
          </p>
        </div>

        {/* ── the six pillars ───────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <ul className="flex flex-col gap-2.5" aria-label="Pillar breakdown">
            {PILLARS.map((pillar) => (
              <PillarRow
                key={pillar.key}
                pillar={pillar}
                value={score.pillars[pillar.key as PillarKey]}
                open={expanded === pillar.key}
                onToggle={() => setExpanded(expanded === pillar.key ? null : pillar.key)}
              />
            ))}
          </ul>

          {/*
            THE ARITHMETIC, SAID OUT LOUD. Without this line a reader who adds
            the bars gets a different number from the one printed beside them
            and has no way to find out why — the subtraction happens inside a
            matview and appears nowhere in the payload.
          */}
          <p data-sum-note="" className="mt-3 text-caption text-text-3">
            {penalised ? (
              <>
                The six pillars sum to <b className="tabular-nums">{fmt.num(sum, 1)}</b>.{' '}
                <b>{fmt.num(SUSPICION_PENALTY)} points were subtracted</b> for anti-gaming signals
                before the band was decided, which is why the total beside them is lower.
              </>
            ) : (
              <>
                The six pillars sum to <b className="tabular-nums">{fmt.num(sum, 1)}</b>, rounded to
                the total beside them. Nothing has been subtracted.
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════ one row ══ */

function PillarRow({
  pillar,
  value,
  open,
  onToggle,
}: {
  pillar: PillarMeta;
  value: number;
  open: boolean;
  onToggle: () => void;
}) {
  const explainId = `pillar-explain-${pillar.key}`;
  const ratio = pillar.max > 0 ? Math.min(1, Math.max(0, value / pillar.max)) : 0;
  const printed = fmt.num(value, 1);

  return (
    <li className="flex flex-col gap-1">
      {/*
        THE BAR IS A SIBLING OF THE BUTTON, NOT A CHILD OF IT. A `<button>`
        takes phrasing content only, and `GapBar` — which the immeasurable
        pillar needs — renders a `<div>`. The live card could nest its track
        because every track was a span with a coloured span inside it; the
        moment one of the six became an honest hatch, the row had to grow a
        second line. The whole label line is still one click target.
      */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={explainId}
        className="-mx-1 flex items-center gap-2 rounded-chip px-1 py-0.5 text-left hover:bg-wash"
      >
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')}
        />
        <span className="min-w-0 flex-1 truncate text-caption font-semibold text-text-1">
          {pillar.label}
        </span>
        <span className="shrink-0 text-right text-caption font-semibold tabular-nums text-text-1">
          {pillar.measurable && printed !== null ? (
            <>
              {printed}
              <span className="text-text-3"> / {fmt.num(pillar.max)}</span>
            </>
          ) : (
            <NotMeasured
              state="unmeasured"
              why={pillar.why ?? 'This pillar carries no reading.'}
              className="text-right"
            />
          )}
        </span>
      </button>

      <div className="relative h-2.5 overflow-hidden rounded-chip bg-wash">
        {pillar.measurable ? (
          <span
            data-bar={pillar.key}
            className="absolute inset-y-0 left-0 rounded-chip"
            style={{ width: `${ratio * 100}%`, background: fillFor(ratio) }}
          />
        ) : (
          /* NOT a bar of length zero. The pillar was never computed, and a
             zero-length bar in a row of five real ones is exactly the
             fabrication `GapBar` exists to replace. */
          <GapBar label={pillar.label} />
        )}
      </div>

      {open && (
        <p id={explainId} className="pl-5 text-caption leading-snug text-text-2">
          {pillar.explain}
          {!pillar.weekly && (
            <span className="mt-1 block text-text-3">
              This pillar is not weekly — it joins on the farm alone, so the same figure is written
              into every week of the trend and cannot move between two of them.
            </span>
          )}
          {pillar.why && <span className="mt-1 block text-text-3">{pillar.why}</span>}
        </p>
      )}
    </li>
  );
}
