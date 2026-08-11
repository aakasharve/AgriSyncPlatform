/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * fieldOperatorClient — API client for the farm-scoped Field Operator routes
 * (spec: 2026-07-13-labour-attendance-approval-design):
 *   - `GET  .../labour/field-operators`            (Task 12 read-model: `FieldOperatorSummaryDto`)
 *   - `POST .../labour/field-operators`            (Task 11 create)
 *   - `POST .../labour/field-operators/{id}/attach` (Task 11 attach — idempotent by intent)
 *
 * The PATCH rename route exists server-side but has no V1 farmer surface, so
 * it deliberately has no client function here — an unused wrapper would read
 * as a shipped capability that nothing can reach.
 *
 * SEPARATE FROM labourClient (binding — A11/A12, do not merge). A Field
 * Operator answers "whose work can be attributed": a durable work-subject
 * id (`GetFieldOperatorsHandler` / `FieldOperator` domain entity) that is
 * NEVER a user id. `labourClient`'s `people` roster answers a different
 * question — "who has access" — built from `farm_memberships` filtered to
 * Mukadam/Worker and keyed by a raw user GUID. Unioning the two rosters, or
 * routing this fetch through `labourClient`'s mapping, would conflate two
 * different identity systems in one field. See the backend
 * `GetFieldOperatorsQuery` file header for the full rationale.
 *
 * TRANSPORT (binding — same reasoning as `labourClient`, BUG 1 2026-08-10):
 * this goes through the app's ONE shared HTTP client, `agriSyncClient.http`.
 * Its request interceptor attaches the in-memory access token and its
 * response interceptor turns a 401 into ONE single-flight
 * `refreshSession()` + ONE retry of the original request. No private
 * `fetch()` / `authHeaders()` copy.
 *
 * @module features/labour/data/fieldOperatorClient
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';

// ============================================================================
// Wire DTO — camelCase, mirrors
// ShramSafal.Application.Contracts.Dtos.FieldOperatorSummaryDto field-for-field.
// Deliberately NOT LabourPersonDto's shape — a Field Operator carries no
// role/verified/balance/access fields; it is a bare work-identity record.
// ============================================================================

export interface FieldOperatorSummaryDto {
    id: string;
    displayName: string;
    fullName: string | null;
    isActive: boolean;
}

/**
 * Task 11's WRITE-side projection —
 * `ShramSafal.Application.Contracts.Dtos.FieldOperatorDto`, what
 * `POST .../field-operators` returns on 201. Wider than the summary above
 * (it carries provenance: originating farm, creator, created-at); the picker
 * needs none of that, so `createFieldOperator` narrows it to the same
 * `FieldOperator` shape the list returns rather than leaking two different
 * "a field operator" types into the UI.
 */
export interface FieldOperatorCreatedDto {
    id: string;
    displayName: string;
    fullName: string | null;
    originatingFarmId: string;
    createdByUserId: string;
    createdAtUtc: string;
    isActive: boolean;
}

/**
 * `ShramSafal.Application.UseCases.Labour.AttachFieldOperator.AttachFieldOperatorResult`.
 *
 * `alreadyAttached: true` is a SUCCESS outcome, not an error — attach is
 * idempotent by intent (Task 11.5), so a farmer who taps the same person
 * twice (or retries after a flaky network) gets the same 200 back. Callers
 * must never render it as a failure.
 */
export interface AttachFieldOperatorResultDto {
    fieldOperatorId: string;
    labourAssignmentId: string;
    alreadyAttached: boolean;
}

/**
 * Frontend-facing shape. Field-for-field identical to the wire DTO today —
 * kept as its own mapped type (rather than exporting the DTO for direct use)
 * so a future FE-only field, or a future wire-shape change, never means a
 * signature change at every call site. `fullName` follows `labourClient`'s
 * null -> undefined convention for optional fields.
 */
export interface FieldOperator {
    id: string;
    displayName: string;
    fullName?: string;
    isActive: boolean;
}

/**
 * Relative to `agriSyncClient.http`'s `baseURL` (resolved once from
 * `VITE_AGRISYNC_API_URL`), same convention as `labourDataPath`.
 */
export const fieldOperatorsPath = (farmId: string): string =>
    `/shramsafal/farms/${farmId}/labour/field-operators`;

/** Task 11 attach route — the ONE way a work identity reaches an engagement. */
export const attachFieldOperatorPath = (farmId: string, fieldOperatorId: string): string =>
    `${fieldOperatorsPath(farmId)}/${fieldOperatorId}/attach`;

const mapFieldOperator = (dto: FieldOperatorSummaryDto): FieldOperator => ({
    id: dto.id,
    displayName: dto.displayName,
    fullName: dto.fullName ?? undefined,
    isActive: dto.isActive,
});

/**
 * Fetches the farm's field-operator roster (work identities a labour
 * engagement can be attributed to) and maps it into the frontend
 * `FieldOperator[]` contract.
 *
 * A 401 is handled BEFORE this function's caller ever sees it: the shared
 * client refreshes the session once and replays this exact request (see the
 * TRANSPORT note above). Anything that still fails after that — server
 * down, refresh genuinely rejected — throws; this client never falls back
 * to a mock roster.
 */
export async function fetchFieldOperators(farmId: string): Promise<FieldOperator[]> {
    const response = await agriSyncClient.http.get<FieldOperatorSummaryDto[]>(
        fieldOperatorsPath(farmId),
    );
    return response.data.map(mapFieldOperator);
}

/**
 * Mints a NEW work identity on this farm (Task 11 `CreateFieldOperator`).
 *
 * IDENTICAL NAMES ARE LEGITIMATE (B2): the server deliberately does NOT
 * de-duplicate on `displayName` — two real people called बाळू are two
 * FieldOperators. This client must therefore never "helpfully" look for an
 * existing match before posting; silently reusing someone else's identity is
 * the exact bug this feature exists to prevent. Disambiguation is a DISPLAY
 * problem, solved in `FieldOperatorPicker`.
 *
 * `fullName` is optional and sent only when non-empty — an empty string is
 * not a full name, and the column is nullable.
 */
export async function createFieldOperator(
    farmId: string,
    displayName: string,
    fullName?: string,
): Promise<FieldOperator> {
    const trimmedFullName = fullName?.trim();
    const response = await agriSyncClient.http.post<FieldOperatorCreatedDto>(
        fieldOperatorsPath(farmId),
        {
            displayName: displayName.trim(),
            ...(trimmedFullName ? { fullName: trimmedFullName } : {}),
        },
    );
    const dto = response.data;
    return {
        id: dto.id,
        displayName: dto.displayName,
        fullName: dto.fullName ?? undefined,
        isActive: dto.isActive,
    };
}

/**
 * Attaches a work identity to ONE labour engagement (`labourAssignmentId`,
 * minted client-side at confirm-time by Task 7.3's
 * `ensureLabourAssignmentIds`).
 *
 * ATTRIBUTION NEVER CHANGES HEADCOUNT (Constraint 3). This posts an overlay
 * row only; `LabourAssignment.WorkerCount` is untouched by the server and
 * must be untouched by every caller of this function. A log that says 8
 * still says 8 with three people attached.
 *
 * A repeat attach returns 200 with `alreadyAttached: true` — success, not an
 * error (see `AttachFieldOperatorResultDto`).
 */
export async function attachFieldOperator(
    farmId: string,
    fieldOperatorId: string,
    labourAssignmentId: string,
): Promise<AttachFieldOperatorResultDto> {
    const response = await agriSyncClient.http.post<AttachFieldOperatorResultDto>(
        attachFieldOperatorPath(farmId, fieldOperatorId),
        { labourAssignmentId },
    );
    return response.data;
}
