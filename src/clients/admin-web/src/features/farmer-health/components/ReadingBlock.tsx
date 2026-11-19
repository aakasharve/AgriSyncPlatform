import { MetricLines } from '@/components/state';
import { fmt } from '@/lib/format';
import type { FarmerHealthReadingDto, FarmerHealthReadingsDto } from '../farmer-health.types';

const REASON_WORDS: Record<NonNullable<FarmerHealthReadingDto['notMeasuredReason']>, string> = {
  denominator_zero: 'Nothing was read in these 14 days, so there is no share to show.',
  saved_not_recorded: 'The app does not record which of these were saved, so no share is shown.',
};

const KINDS: { key: keyof FarmerHealthReadingsDto; label: string }[] = [
  { key: 'voice', label: 'Voice recordings' },
  { key: 'receipt', label: 'Receipt photos' },
  { key: 'patti', label: 'Patti photos' },
];

function share(r: FarmerHealthReadingDto): string | null {
  if (r.notMeasuredReason !== null) return null;
  return fmt.pct(r.savedPct14d, 1);
}

function why(r: FarmerHealthReadingDto): string {
  if (r.notMeasuredReason) return REASON_WORDS[r.notMeasuredReason];
  return 'The server sent no share for this one.';
}

/** P10 (the saved share) and P11 (the count read), in one block over 14 days. */
export function ReadingBlock({ reading }: { reading: FarmerHealthReadingsDto }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="fh-reading-head">
      <h2 id="fh-reading-head" className="text-h2 font-bold text-text-1">
        Voice and photo reading
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div data-metric="fh-reading-rates" className="glass-panel rounded-panel p-5">
          <h3 className="text-h3 font-semibold text-text-1">Voice and photo reading</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {KINDS.map((k) => {
              const r = reading[k.key];
              const pct = share(r);
              return (
                <li key={k.key} data-reading={k.key} className="text-body">
                  <span className="text-text-2">{k.label}: </span>
                  {pct !== null ? (
                    <span data-share="" className="font-semibold tabular-nums text-text-1">
                      {pct} read and saved
                    </span>
                  ) : (
                    <span data-not-measured="" className="text-text-2">
                      {why(r)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <MetricLines metric="fh-reading-rates" className="mt-2" />
        </div>
        <div data-metric="fh-reading-count" className="glass-panel rounded-panel p-5">
          <h3 className="text-h3 font-semibold text-text-1">Recordings and photos read</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {KINDS.map((k) => (
              <li key={k.key} data-count={k.key} className="text-body">
                <span className="text-text-2">{k.label}: </span>
                <span className="font-semibold tabular-nums text-text-1">
                  {fmt.num(reading[k.key].finishedJobs14d)}
                </span>
              </li>
            ))}
          </ul>
          <MetricLines metric="fh-reading-count" className="mt-2" />
        </div>
      </div>
    </section>
  );
}
