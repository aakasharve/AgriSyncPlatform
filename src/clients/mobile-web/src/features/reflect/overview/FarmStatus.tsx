/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3; lane UI-7, founder D-150)
 *
 * शेताची स्थिती — which crop and which plots the whole page shows, on the farm's real crops and plots, in plain words: "सर्व पिकं"
 * or one crop (its photo, "2 पैकी 2 प्लॉट"), then that crop's plots, each with its crop's colour. Picking here narrows EVERY section
 * below. The page starts on every crop and every plot (`ReflectPage` holds `null` = all).
 *
 * Lane UI-7: the look is THE shared crop -> plot picker (`context/components/CropPlotPicker.tsx`), the same photo tiles and coloured
 * plot chips every other page uses. This file only adapts the page's own selection model (`reflectSelection.ts`, unchanged) to it.
 * Every Marathi string is PROPOSED.
 */
import React from 'react';
import type { CropProfile } from '../../../types';
import { pickCrop, togglePlot, type ReflectSelection } from './reflectSelection';
import { CropPlotPicker } from '../../context/components/CropPlotPicker';

const TEST_IDS = {
    crop: (key: 'all' | string) => `farm-crop-${key}`,
    plot: (plotId: string) => `farm-plot-${plotId}`,
};

export const FarmStatus: React.FC<{ crops: readonly CropProfile[]; sel: ReflectSelection; onSel: (s: ReflectSelection) => void }> = ({ crops, sel, onSel }) => {
    if (crops.length === 0) {
        return <p className="m-0 rounded-2xl bg-stone-50 p-3 text-center text-[14.5px] font-bold text-stone-600" data-testid="farm-status-empty">अजून पीक जोडलेलं नाही — शेत सेटअपमध्ये पीक आणि प्लॉट जोडा.</p>;
    }
    return (
        <div data-testid="farm-status">
            <CropPlotPicker crops={crops} chosen={sel.crop} pickedPlotIds={sel.plotIds} allCrops testIds={TEST_IDS}
                onPickCrop={key => onSel(pickCrop(crops, key))}
                onTogglePlot={(_cropId, plotId) => onSel(togglePlot(crops, sel, plotId))} />
            <p className="m-0 mt-2 text-[12.5px] font-semibold text-stone-500">खालचं सगळं (कामं, प्लॉटचं काम, नोंदी, कॅलेंडर, खर्च) याच प्लॉटचं दिसतं.</p>
        </div>
    );
};
