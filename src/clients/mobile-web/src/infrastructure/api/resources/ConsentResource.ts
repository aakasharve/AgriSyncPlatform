// spec: data-principle-spine-2026-05-05/06.4
//
// Consent resource — three endpoints on the ShramSafal backend
// (06.2 / 06.3 in flight in parallel — see plan
// `_COFOUNDER/.../06_[30]_CONSENT_DOMAIN.md` §6.2.2 + §6.3):
//
//   GET  /shramsafal/consent/me               -> ConsentStateDto
//   PUT  /shramsafal/consent/me               -> ConsentStateDto (updated)
//   POST /shramsafal/consent/token/issue      -> IssueConsentTokenResponse
//
// NOTE: assumes 06.3 backend lands /shramsafal/consent/token/issue. If
// the wire path differs, fix this file in a follow-up; no other module
// mirrors these strings.

import type { HttpTransport } from '../transport';
import type {
    ConsentStateDto,
    UpdateConsentRequest,
    IssueConsentTokenResponse,
} from '../dtos';

/**
 * Map the wire body. Only the grant-start field needs care: anything that is
 * not a parseable timestamp string becomes null, so a consumer can fail closed
 * on one value instead of re-validating.
 */
export function normalizeConsentDto(wire: ConsentStateDto): ConsentStateDto {
    const since = wire?.fullHistoryJournalGrantedSinceUtc;
    return {
        ...wire,
        fullHistoryJournalGrantedSinceUtc:
            typeof since === 'string' && Number.isFinite(Date.parse(since)) ? since : null,
    };
}

export async function getConsent(t: HttpTransport): Promise<ConsentStateDto> {
    const response = await t.http.get<ConsentStateDto>('/shramsafal/consent/me');
    return normalizeConsentDto(response.data);
}

export async function updateConsent(
    t: HttpTransport,
    request: UpdateConsentRequest,
): Promise<ConsentStateDto> {
    const response = await t.http.put<ConsentStateDto>('/shramsafal/consent/me', request);
    return response.data;
}

export async function issueConsentToken(
    t: HttpTransport,
): Promise<IssueConsentTokenResponse> {
    const response = await t.http.post<IssueConsentTokenResponse>(
        '/shramsafal/consent/token/issue',
        {},
    );
    return response.data;
}
