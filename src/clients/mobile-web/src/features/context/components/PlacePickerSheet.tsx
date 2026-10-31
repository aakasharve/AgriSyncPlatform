/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder rule CTX-1, 2026-10-31: "make sure we always
 * redirect to the same canonical crop and plot selector flow every time whenever needed").
 *
 * The ONE crop → plot selector, for a screen that needs WHERE but has no mic after it: the "झालेले काम सांगा" steps
 * themselves (`CropSelector` on `CropPlotStepper` with Sathi's band — "कोणत्या पिकावर काम झालं ?" → "… कोणत्या प्लॉट वर
 * …", several plots allowed, "संपूर्ण शेत"), with one button in place of the mic: "हे निवडा". Nothing is pre-picked;
 * Sathi's guess or the place the entry is on now may be MARKED on its plot, never chosen for him.
 *
 * Its own selection, never the log tab's (choosing here never moves the recorder's plots). Full screen, its buttons
 * inside it (rule FOOT-1).
 */
import React, { useState } from 'react';
import { Check } from 'lucide-react';
import type { CropProfile, LogScope } from '../../../types';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { PHONE_COLUMN } from '../../logs/components/phoneColumn';
import { SathiAskBand } from '../../logs/components/entry/SathiAskBand';
import { STEPPER_LABELS } from '../../logs/components/entry/entryWords';
import { plotsByCrop } from '../../logs/components/entry/LogEntryFlow';
import CropSelector from './CropSelector';
import FlowBackButton from './FlowBackButton';
import type { StepperStep } from './CropPlotStepper';

const SANS = "'Noto Sans Devanagari', sans-serif";
const FARM_GLOBAL = 'FARM_GLOBAL';
const EMPTY: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

export const PLACE_PICKER_WORDS = {
    mr: { choose: 'हे निवडा' }, // PROPOSED (Marathi)
    en: { choose: 'Choose this' }, // PROPOSED (English)
} as const;

export interface PlacePickerSheetProps {
    crops: CropProfile[];
    onPick: (scope: LogScope) => void;
    onClose: () => void;
    /** Plots to mark (Sathi's guess / where it is now), with the mark's word. */
    marked?: { plotIds: readonly string[]; label: string };
    /** A past day he chose (D-60): the questions name it. */
    forDay?: string;
    /** 'income': the same steps asking where an income came from. */
    ask?: 'work' | 'income';
}

/** Is a choice made (a plot, or the whole farm)? */
export const isPlaceChosen = (scope: LogScope): boolean =>
    scope.selectedPlotIds.length > 0 || scope.selectedCropIds.includes(FARM_GLOBAL);

export const PlacePickerSheet: React.FC<PlacePickerSheetProps> = ({ crops, onPick, onClose, marked, forDay, ask = 'work' }) => {
    const language = useOptionalLanguage()?.language;
    const words = language === 'en' ? PLACE_PICKER_WORDS.en : PLACE_PICKER_WORDS.mr;
    const [scope, setScope] = useState<LogScope>(EMPTY);
    const [step, setStep] = useState<StepperStep>('crop');
    // Back is one step: plots → crops → out.
    const back = () => { if (step === 'plot') { setScope(EMPTY); setStep('crop'); } else onClose(); };
    useBackDismiss(true, back);
    return (
        <div className="fixed inset-0 z-[88] flex justify-center bg-stone-900/30" data-testid="place-picker" style={{ fontFamily: SANS }}>
            <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true">
                <div className="min-h-0 flex-1 overflow-y-auto pb-24">
                    {step === 'crop' && (
                        <div className="flex items-center gap-2 px-3 pt-2">
                            <FlowBackButton onClick={onClose} testId="place-picker-back" />
                        </div>
                    )}
                    <CropSelector
                        mode="log" layout="stepper" crops={crops}
                        selectedCrops={scope.selectedCropIds}
                        selectedPlots={plotsByCrop(crops, scope)}
                        onSelectionChange={(newCrops, newPlots) => {
                            const plots = Object.values(newPlots).flat();
                            setScope({ selectedCropIds: newCrops, selectedPlotIds: plots, mode: plots.length > 1 ? 'multi' : 'single', applyPolicy: 'broadcast' });
                        }}
                        stepper={{
                            step,
                            onStepChange: setStep,
                            lead: ctx => <SathiAskBand {...ctx} forDay={forDay} ask={ask} />,
                            labels: STEPPER_LABELS,
                            marked,
                            footer: () => (
                                <button type="button" onClick={() => onPick(scope)} disabled={!isPlaceChosen(scope)} data-testid="place-picker-choose"
                                    className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 text-[18px] font-extrabold text-white disabled:bg-stone-300">
                                    <Check size={20} aria-hidden="true" />{words.choose}
                                </button>
                            ),
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default PlacePickerSheet;
