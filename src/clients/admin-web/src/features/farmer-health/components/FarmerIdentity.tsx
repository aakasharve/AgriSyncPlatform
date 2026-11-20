import { MetricLines, PhoneText } from '@/components/state';
import { PersonName } from '@/components/ui/PersonName';

/**
 * P1: the farm owner's name and phone, so the team can call the right person
 * from this page. A name or phone the server did not record says so in words;
 * nothing is invented.
 */
export function FarmerIdentity({
  farmerName,
  farmName,
  phone,
}: {
  farmerName: string | null | undefined;
  farmName: string | null | undefined;
  phone: string | null | undefined;
}) {
  const hasName = typeof farmerName === 'string' && farmerName.trim().length > 0;
  const hasPhone = typeof phone === 'string' && phone.trim().length > 0;
  return (
    <section
      data-metric="fh-name-phone"
      aria-label="Farmer name and phone"
      className="glass-panel rounded-panel p-5"
    >
      <h3 className="text-h3 font-semibold text-text-1">Farmer name and phone</h3>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-body">
        <dt className="text-text-3">Name</dt>
        <dd data-field="farmer-name" className="font-semibold text-text-1">
          {hasName ? (
            <PersonName name={farmerName} fallback="Name not recorded" />
          ) : (
            'Name not recorded'
          )}
        </dd>
        <dt className="text-text-3">Phone</dt>
        <dd data-field="phone" className="tabular-nums text-text-1">
          <PhoneText value={hasPhone ? phone : null} />
        </dd>
        {farmName ? (
          <>
            <dt className="text-text-3">Farm</dt>
            <dd data-field="farm-name" className="text-text-1">
              <PersonName name={farmName} fallback="Farm name not recorded" />
            </dd>
          </>
        ) : null}
      </dl>
      <MetricLines metric="fh-name-phone" className="mt-2" />
    </section>
  );
}
