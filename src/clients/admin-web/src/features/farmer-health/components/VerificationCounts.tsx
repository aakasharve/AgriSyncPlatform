import { MetricLines } from '@/components/state';
import { fmt } from '@/lib/format';
import type { FarmerHealthChecksDto } from '../farmer-health.types';

const ITEMS: { key: keyof FarmerHealthChecksDto; label: string }[] = [
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'verified', label: 'Verified' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'pending', label: 'Waiting for a check' },
  { key: 'selfChecked', label: 'Checked only by the person who saved it' },
];

/** P6: the five counts of entries by their latest check. Zeros are true zeros. */
export function VerificationCounts({ counts }: { counts: FarmerHealthChecksDto }) {
  return (
    <section
      data-metric="fh-verification-counts"
      aria-label="Checks on entries"
      className="glass-panel rounded-panel p-5"
    >
      <h3 className="text-h3 font-semibold text-text-1">Checks on entries</h3>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-body">
        {ITEMS.map((i) => (
          <div key={i.key} data-count={i.key} className="contents">
            <dt className="text-text-2">{i.label}</dt>
            <dd className="text-right font-semibold tabular-nums text-text-1">
              {fmt.num(counts[i.key])}
            </dd>
          </div>
        ))}
      </dl>
      <MetricLines metric="fh-verification-counts" className="mt-2" />
    </section>
  );
}
