/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — what a `DailyLog` knows about the
 * SERVER's copy of it. Split out of `log.types.ts`, which sits at the 800-line cap
 * (`npm run check:file-sizes`); `DailyLog` extends this interface, so every reader still sees the
 * members on the log itself.
 */
export interface DailyLogServerState {
    /**
     * The record's version on the server (`DailyLog.ContentVersion`) as this phone last received it:
     * 1 at creation, +1 for every change to what the record says. A confirm sends it back
     * (`verify_log_v2.logVersion`), so a record that changed since it was shown is seen before it
     * is confirmed (founder D-46). Absent = this phone has not heard a version (not yet synced, or an
     * older server); never guessed.
     */
    contentVersion?: number;

    /**
     * `true` = the crop work, water, inputs and notes on this log were rebuilt from the server's
     * TASK LINES, because the server holds no details for it (a record from an older app, or from
     * before lane F1) and this phone has none of its own. Only what a line says is shown — its name
     * and its note, nothing made up (doctrine P4): every value the line cannot say is absent and is
     * shown as "—".
     *
     * `false` = the details came from the server's stored record (`DailyLogDto.content`), exactly.
     * Absent = this phone's own record (it made it), which a silent server never overwrites.
     */
    legacyPartial?: boolean;

    /**
     * lane MU-3 fix 1 (F8) — `true` = the server sent this copy WITHOUT the amounts it states (this person does
     * not see the farm's money and did not make the record: `LogContentDto.amountsWithheld`). An edit of it says
     * so (`revise_log_content.amountsWithheld`), so the server carries the amounts forward instead of reading
     * their absence as "no longer spent". Absent = the copy is whole.
     */
    amountsWithheld?: boolean;

    /**
     * lane MU-3 fix 1 (F3, founder D-66 = option 1) — `true` = the record mentions money, and by ShramSafal's rule
     * its words and voice are not sent to this person (`DailyLogDto.wordsWithheldForMoney`). The work itself is
     * all here; the record card says so in the rule's words (FIX-1 item 16, W1) instead of showing an empty
     * transcript. Absent = nothing was withheld for money.
     */
    wordsWithheldForMoney?: boolean;
}
