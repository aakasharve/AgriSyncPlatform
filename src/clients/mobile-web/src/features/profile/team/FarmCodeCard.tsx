/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FarmCodeCard — the farm's permanent, unique code, big, with the way to show the farm QR.
 * Design ported from the approved PLR-D7 preview (plr-d1a `multiuser/muUi.tsx` FarmCodeCard):
 * the code never changes; only the QR token can be re-issued (in the QR sheet).
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, MU-10). Real data only: the code is the one the
 * server holds for this farm (`/farms/mine`). No code yet → said so, never a made-up one (P4); the
 * QR sheet assigns one when it opens (step 1).
 */
import React from 'react';
import { KeyRound, QrCode } from 'lucide-react';
import { SANS, Tap } from '../../../shared/components/ui/placeUi';
import { TEAM_COPY } from './teamCopy';

export const FarmCodeCard: React.FC<{ code: string | null | undefined; onShowQr?: () => void }> = ({ code, onShowQr }) => (
    <div className="rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-3" data-testid="farm-code-card" style={{ fontFamily: SANS }}>
        <p className="m-0 flex items-center gap-1.5 text-[13px] font-extrabold text-emerald-900"><KeyRound size={16} aria-hidden="true" />{TEAM_COPY.code}</p>
        {code ? (
            <>
                <p className="m-0 mt-0.5 font-mono text-[30px] font-extrabold leading-tight tracking-[0.12em] text-emerald-950" data-testid="farm-code">{code}</p>
                <p className="m-0 mt-0.5 text-[12px] font-bold text-emerald-900">{TEAM_COPY.codeStays}</p>
            </>
        ) : (
            <p className="m-0 mt-1 text-[13.5px] font-bold text-emerald-900" data-testid="farm-code-missing">{TEAM_COPY.noCodeYet}</p>
        )}
        {onShowQr && (
            <Tap onClick={onShowQr} data-testid="team-show-qr" rippleColor="rgba(255,255,255,0.35)"
                className="mt-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-emerald-700 text-[15.5px] font-extrabold text-white shadow">
                <QrCode size={19} aria-hidden="true" />{TEAM_COPY.showQr}
            </Tap>
        )}
    </div>
);

export default FarmCodeCard;
