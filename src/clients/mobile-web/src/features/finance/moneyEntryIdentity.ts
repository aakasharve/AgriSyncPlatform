/**
 * spec: pre-launch-repair L2b (R-1; founder D-41 phase A) — ONE identity per money entry.
 *
 * Every money entry the phone sends carries an id DERIVED from its own deterministic source key
 * (`<billId>:<lineId>`, `<billId>:total`, `<logId>:input:<entryId>`, `<sessionId>:sale:<saleId>`, …): a
 * name-based UUID (RFC 4122 version 5) of that key. So a retry, a second tap, a reopen of खरेदी, a recovery
 * send or a later re-derivation of the same source all send the SAME id — and the server answers a repeat of
 * an id it already holds (same farm, same person) with the stored entry instead of a second row. It used to be
 * a fresh random id per call, which made every repeat a new expense.
 *
 * A typed (manual) entry has no source record of its own until its sheet mints one: the sheet mints its record
 * id ONCE when it opens (`ReceiptCaptureSheet` the bill id, `OtherIncomeSheet` the income id), so a double tap
 * on "जतन करा" is the same entry, not two.
 */
import { v5 as uuidv5 } from 'uuid';

/**
 * NEVER CHANGE THIS VALUE. Every money entry id ever sent was derived under it; a new namespace would give
 * every source a second id, and every re-send after an upgrade would become a second expense on the server.
 */
export const MONEY_ENTRY_ID_NAMESPACE = '3f0c9a52-6d1e-4b7a-9c84-5e2f17a3d6b9';

/** The money entry id for one source key — the same key always gives the same id. */
export function moneyEntryIdFor(sourceId: string): string {
    return uuidv5(sourceId, MONEY_ENTRY_ID_NAMESPACE);
}
