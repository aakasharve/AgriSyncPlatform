import { Masked } from './Masked';
import { isPartlyMasked, isRedacted } from './redaction';

/** What a phone the caller may not see reads as. Never "Phone not recorded": that is a different fact. */
export const HIDDEN_PHONE_TEXT = 'Hidden for you';

/**
 * A farmer's phone number, as the console shows it (CR-3, H4).
 *
 * The server sends the redaction marker for a number the caller has no `farmer_phones` tick for.
 * That is a permission fact, not a missing number, so it reads "Hidden for you" and never "Phone
 * not recorded". A number the server really has no record of (null or blank) reads `whenNone`; a
 * partly masked one is shown as sent, through `Masked`.
 */
export function PhoneText({
  value,
  whenNone = 'Phone not recorded',
  className,
}: {
  value: string | null | undefined;
  whenNone?: string;
  className?: string;
}) {
  if (isRedacted(value)) {
    return (
      <span data-masked="redacted" data-field-state="hidden-for-you" className={className}>
        {HIDDEN_PHONE_TEXT}
      </span>
    );
  }
  if (value === null || value === undefined || value.trim() === '') return <>{whenNone}</>;
  if (isPartlyMasked(value)) return <Masked value={value} className={className} />;
  return <>{value}</>;
}
