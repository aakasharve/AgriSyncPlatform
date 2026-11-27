/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P1) - the port to the phone's copy of each farm's setup as the server
 * holds it. Read one farm's set; replace the farms a pull carried, each WHOLE (a farm the pull did not carry is never touched).
 */
import type { FarmSetupSet } from '../../domain/types/farmSetup.types';

export interface FarmSetupRepository {
    /** The farm's set as the last pull that carried it said, or null when the server never sent this farm (an old server, or no pull asked yet). */
    read(farmId: string): Promise<FarmSetupSet | null>;
    /** Each set replaces its farm's rows whole. Other farms keep theirs. */
    replaceFarms(sets: readonly FarmSetupSet[]): Promise<void>;
    /** A farm this person may no longer read: its rows leave the phone. */
    removeFarms(farmIds: readonly string[]): Promise<void>;
}
