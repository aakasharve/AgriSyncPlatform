/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §6). The role band: "तुम्ही: ‹नाव› · ‹भूमिका›" with
 * the plots line from MU-4 ("सर्व प्लॉट" / "3 प्लॉट" / "स्वतःचं काम"), under the header on every screen. It says who he is on
 * the farm that is open. Drawn for everyone except a single-farm primary owner, whose screens stay as today (Scenario A).
 */
import React from 'react';
import type { MeContext } from '../../core/session/MeContextService';
import { roleBandFor } from './relationshipModel';

export interface RoleBandProps {
    meContext: MeContext | null | undefined;
    currentFarmId: string | null | undefined;
    language: string | null | undefined;
}

export const RoleBand: React.FC<RoleBandProps> = ({ meContext, currentFarmId, language }) => {
    const band = roleBandFor(meContext, currentFarmId, language);
    if (!band) return null;
    return (
        <div className="mx-auto w-full max-w-[480px] px-3 pb-2 md:max-w-[600px] xl:max-w-[640px]" data-testid="role-band">
            <p className="m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-[13.5px] font-extrabold text-emerald-900 ring-1 ring-emerald-100">
                <span data-testid="role-band-line" className="[overflow-wrap:anywhere]">{band.line}</span>
                <span data-testid="role-band-plots" className="text-[12.5px] font-bold text-emerald-800">{band.plots}</span>
            </p>
        </div>
    );
};

export default RoleBand;
