/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (register R3-L2; MU design §11.6). A seat that covers chosen
 * plots with money sees his plots' totals only, "तुमच्या प्लॉटचे" - said on the money ledger and the money manager so the figure is
 * never read as the whole farm's (P4). The phone holds only the money records its pull sent (his plots'), so the totals are his
 * plots' by construction; this line says so. Not drawn for the primary owner or any seat on every plot.
 */
import React from 'react';
import { useOptionalFarmContext } from '../../core/session/FarmContext';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { plotScopeCopy } from '../profile/team/plotScopeCopy';
import { isChosenPlotsSeat } from './relationshipModel';

export const PlotsOnlyNote: React.FC<{ testId?: string }> = ({ testId = 'totals-plots-only' }) => {
    const farm = useOptionalFarmContext()?.currentFarm ?? null;
    const language = useOptionalLanguage()?.language;
    if (!isChosenPlotsSeat(farm)) return null;
    return (
        <p className="m-0 px-1 text-[13px] font-extrabold text-amber-800" data-testid={testId}>
            {plotScopeCopy(language).totalsLabel}
        </p>
    );
};

export default PlotsOnlyNote;
