/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The web address a farm's join QR encodes (moved here from `FarmInviteQrSheet` unchanged, so the sheet and the hub's farm card draw the SAME QR;
 * pilot lane IDENT, V2-A). Web: the current origin. Native (APK, origin https://localhost): the public web origin, so the link works for whoever
 * scans it. The server's own `qrPayload` (the public marketing URL that 302s here) is used where there is no window.
 */
import { getShareOrigin } from '../../../shared/config/publicWebOrigin';
import type { InviteResponse } from './inviteApi';

export function inviteShareUrl(invite: Pick<InviteResponse, 'token' | 'farmCode' | 'qrPayload'>): string {
    if (typeof window === 'undefined') return invite.qrPayload;
    const params = new URLSearchParams();
    params.set('join', invite.token);
    params.set('farm', invite.farmCode);
    return new URL(`/?${params.toString()}`, getShareOrigin()).toString();
}
