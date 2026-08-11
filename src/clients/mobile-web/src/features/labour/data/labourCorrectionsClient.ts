/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * labourCorrectionsClient — API client for the Labour V1 Task 12b correction
 * route (spec: 2026-07-13-labour-attendance-approval-design):
 *
 *   `POST /shramsafal/farms/{farmId}/labour/assignments/{id}/corrections`
 *
 * GATE B, doctrine P2: record now, inspect later, correct, trust the final
 * record. A farmer learning the app WILL record 8 when it was 6. "Once saved
 * you cannot correct it" makes people afraid to log at all.
 *
 * P3 — a correction is never a silent mutation. The server writes the corrected
 * values onto the engagement AND appends an immutable `labour_corrections` row
 * per changed field saying what it used to be, who changed it and when.
 *
 * SILENCE IS NOT A CORRECTION. Every section of the body is optional and the
 * caller must OMIT what the reviewer did not state — omitting `durationHours`
 * leaves the engagement's existing `Assumed` hours untouched, whereas sending a
 * number the farmer never said would fabricate a measurement. This is the same
 * omit-don't-coerce rule `buildLabourPayloads` already follows on the create
 * path.
 *
 * TRANSPORT (binding — same reasoning as `labourClient` / `fieldOperatorClient`):
 * the app's ONE shared HTTP client, `agriSyncClient.http`. Its request
 * interceptor attaches the access token AND the `X-Device-Id` header — which is
 * load-bearing here, because the server pairs that device id with
 * `clientRequestId` as the idempotency key. No private `fetch()` copy.
 *
 * @module features/labour/data/labourCorrectionsClient
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';

/**
 * The three headcount numbers travel TOGETHER because they are one fact.
 * Sending them separately is what lets a row land contradictory
 * (`workerCount: 6, maleCount: 5, femaleCount: 4`); the server resolves them in
 * one operation. Each is individually optional — absent means "not stated" and
 * is preserved as NULL, never fabricated as 0.
 */
export interface LabourQuantityCorrectionRequest {
    workerCount?: number;
    maleCount?: number;
    femaleCount?: number;
}

/**
 * Request body. `clientRequestId` is REQUIRED: with the `X-Device-Id` header it
 * is what makes a retried correction yield ONE logical correction instead of a
 * second set of history rows.
 */
export interface LabourCorrectionRequest {
    clientRequestId: string;
    reason?: string;
    quantity?: LabourQuantityCorrectionRequest;
    durationHours?: number;
    attributionAdds?: string[];
    attributionRemovals?: string[];
}

/**
 * `ShramSafal.Application.UseCases.Labour.CorrectLabour.CorrectLabourResult` —
 * what is TRUE NOW on the engagement, not a delta.
 *
 * `alreadyApplied: true` means the server replayed a stored answer for this
 * (device, clientRequestId) and wrote nothing. That is a SUCCESS outcome and
 * must never be rendered as a failure — it is the proof the retry did not
 * double-write.
 */
export interface LabourCorrectionResultDto {
    labourAssignmentId: string;
    workerCount: number | null;
    maleCount: number | null;
    femaleCount: number | null;
    durationHours: number;
    /** "Assumed" | "Explicit" — hours never travel without their basis. */
    timeBasis: string;
    attributedFieldOperatorIds: string[];
    correctionsRecorded: number;
    alreadyApplied: boolean;
}

/**
 * Relative to `agriSyncClient.http`'s `baseURL`, same convention as
 * `labourDataPath` / `fieldOperatorsPath`.
 */
export const labourCorrectionPath = (farmId: string, labourAssignmentId: string): string =>
    `/shramsafal/farms/${farmId}/labour/assignments/${labourAssignmentId}/corrections`;

/**
 * Posts ONE review action on ONE engagement.
 *
 * Throws on failure (403 from a farm Worker, 400 from a body that corrects
 * nothing, network down). The caller must surface that rather than swallow it:
 * a correction UI that reports success while the record still says 8 is exactly
 * the fake-working-feature failure this task exists to remove (P5).
 */
export async function postLabourCorrection(
    farmId: string,
    labourAssignmentId: string,
    request: LabourCorrectionRequest,
): Promise<LabourCorrectionResultDto> {
    const response = await agriSyncClient.http.post<LabourCorrectionResultDto>(
        labourCorrectionPath(farmId, labourAssignmentId),
        request,
    );
    return response.data;
}
