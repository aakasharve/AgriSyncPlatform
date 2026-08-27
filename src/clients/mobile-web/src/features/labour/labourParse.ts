/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The CANONICAL labour data points shape. A labour entry always has the SAME
 * shape everywhere (attendance, review, reflect, worker) — that shape is
 * `LabourEntry` below.
 *
 * There is no client-side parser here anymore. Voice input is taken in
 * exactly one place across the app — the log page — which sends the
 * transcript to the server AI engine; the server fills `shift`/`task`/
 * `worker_names_json` on `labour_assignments`, and that's what populates
 * `LabourEntry` for display (see `data/labourClient.ts`, `LabourDataPoints`).
 * A local Marathi parser (`parseLabour`/`parseHeadcount`) used to stand in
 * for that server engine during early UAT; it was removed once the labour
 * mic stopped recording locally (spec:
 * 2026-07-13-labour-attendance-approval-design).
 */

export type LabourShift = 'full' | 'half' | 'night';

/** The canonical data points of one labour entry — identical across all screens. */
export interface LabourEntry {
    /** true if the speech is about labour at all; false → flag "not relevant to labour". */
    relevant: boolean;
    count: number | null;       // मजूर संख्या
    shift: LabourShift | null;  // पूर्ण / अर्धा / रात्रपाळी
    task: string | null;        // काम (छाटणी / फवारणी …)
    amount: number | null;      // मजुरी / उचल (₹), if specifically said
    names: string[];            // नावं (matched workers)
}

export const SHIFT_LABEL: Record<LabourShift, string> = {
    full: 'पूर्ण दिवस',
    half: 'अर्धा दिवस',
    night: 'रात्रपाळी',
};
