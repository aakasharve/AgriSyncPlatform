// spec: data-principle-spine-2026-05-05/06.4
//
// Consent resource — the caller's own consent on the ShramSafal backend:
//
//   GET  /shramsafal/consent/me               -> ConsentStateDto
//   PUT  /shramsafal/consent/me               -> ConsentStateDto (updated)
//   GET  /shramsafal/consent/improvement      -> ImprovementPermissionDto
//   PUT  /shramsafal/consent/improvement      -> ImprovementPermissionDto (updated)
//
// spec: plr-d10 lane F99 fix pass 1 (F100, row 18) — `POST /shramsafal/consent/token/issue` is gone from here: the server
// never had that route (06.3 did not land it) and nothing on the phone ever used the token it would have issued.

import type { HttpTransport } from '../transport';
import type {
    ConsentStateDto,
    UpdateConsentRequest,
    ImprovementPermissionDto,
    SetImprovementPermissionRequest,
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

// plr-d10 I25 (founder D-36) — the optional improvement permission, the caller's own.
export async function getImprovementPermission(t: HttpTransport): Promise<ImprovementPermissionDto> {
    const response = await t.http.get<ImprovementPermissionDto>('/shramsafal/consent/improvement');
    return response.data;
}

export async function setImprovementPermission(
    t: HttpTransport,
    request: SetImprovementPermissionRequest,
): Promise<ImprovementPermissionDto> {
    const response = await t.http.put<ImprovementPermissionDto>('/shramsafal/consent/improvement', request);
    return response.data;
}
