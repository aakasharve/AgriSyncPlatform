/**
 * qrTokenClient — farm-invite QR payload.
 *
 * Deliberately minimal. No TTL, no max-uses, no approval gate. The QR is
 * the fundamental way a farmer brings a worker onto the platform: scan,
 * verify phone, see the farm. Policy complexity is a future concern once
 * fraud signals show up; until then we keep the cognitive load at zero
 * for semi-literate users.
 *
 * When the server lands (Slice 1 Phase 4), this module swaps to calling
 * `POST /farms/{farmId}/invite-qr` and the UI does not change.
 */

export type JoinRole = 'Worker' | 'Mukadam' | 'SecondaryOwner';

export interface FarmInviteQr {
    farmId: string;
    farmName: string;
    farmCode: string;
    proposedRole: JoinRole;
    token: string;
    qrPayload: string;
    issuedAtUtc: string;
}

const FARM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const randomBytes = (length: number) => {
    const buffer = new Uint8Array(length);
    crypto.getRandomValues(buffer);
    return buffer;
};

const toBase64Url = (bytes: Uint8Array) => {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const generateFarmCode = (): string => {
    const bytes = randomBytes(6);
    let out = '';
    for (let i = 0; i < 6; i++) {
        out += FARM_CODE_ALPHABET[bytes[i] % FARM_CODE_ALPHABET.length];
    }
    return out;
};

export interface IssueInviteRequest {
    farmId: string;
    farmName: string;
    farmCode?: string;
    proposedRole?: JoinRole;
}

export const issueFarmInvite = (request: IssueInviteRequest): FarmInviteQr => {
    const token = toBase64Url(randomBytes(24));
    const farmCode = request.farmCode ?? generateFarmCode();
    const proposedRole: JoinRole = request.proposedRole ?? 'Worker';

    const url = new URL('https://shramsafal.app/join');
    url.searchParams.set('t', token);
    url.searchParams.set('f', farmCode);
    url.searchParams.set('r', proposedRole);

    return {
        farmId: request.farmId,
        farmName: request.farmName,
        farmCode,
        proposedRole,
        token,
        qrPayload: url.toString(),
        issuedAtUtc: new Date().toISOString(),
    };
};

export interface ParsedJoinPayload {
    raw: string;
    token: string | null;
    farmCode: string | null;
    proposedRole: JoinRole | null;
    isValid: boolean;
    error?: string;
}

export const parseJoinPayload = (value: string): ParsedJoinPayload => {
    try {
        const url = new URL(value);
        const token = url.searchParams.get('t');
        const farmCode = url.searchParams.get('f');
        const proposedRole = url.searchParams.get('r') as JoinRole | null;
        if (!token || !farmCode) {
            return {
                raw: value,
                token,
                farmCode,
                proposedRole,
                isValid: false,
                error: 'This QR is missing some information. Ask for a new one.',
            };
        }
        return { raw: value, token, farmCode, proposedRole, isValid: true };
    } catch {
        return {
            raw: value,
            token: null,
            farmCode: null,
            proposedRole: null,
            isValid: false,
            error: 'This link does not look right. Ask the farmer to share it again.',
        };
    }
};

/**
 * Build the query string the app uses internally to open the join
 * landing page from inside the mobile-web SPA.
 *
 *   /?join=<token>&farm=<farmCode>&role=<role>
 *
 * When the platform is deployed on https://app.shramsafal.in the marketing
 * deep link (shramsafal.app/join?t=...&f=...) will 302 to this internal
 * route.
 */
export const toInternalJoinUrl = (invite: FarmInviteQr): string => {
    const params = new URLSearchParams();
    params.set('join', invite.token);
    params.set('farm', invite.farmCode);
    params.set('role', invite.proposedRole);
    return `/?${params.toString()}`;
};
