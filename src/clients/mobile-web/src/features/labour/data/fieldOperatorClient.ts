/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * fieldOperatorClient — API client for
 * `GET /shramsafal/farms/{farmId}/labour/field-operators` (Task 12 backend
 * read-model: `FieldOperatorSummaryDto`, spec:
 * 2026-07-13-labour-attendance-approval-design).
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
