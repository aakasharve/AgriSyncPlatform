/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-132 Q1 = 1 "entry only from planning") - the screens that replace the planning page
 * body while he makes or looks at one of his own schedules: the maker (new, or a change to one that exists) and one schedule's own screen. The planning page
 * keeps the state (`OwnFlow`) and draws this INSTEAD of its body; the card with the library (`OwnScheduleLibrary`) is what the body shows otherwise.
 */
import React from 'react';
import type { AudioData, CropProfile, FarmerProfile } from '../../../types';
import type { PlanSpeechResult } from '../../plannedWork/data/planVoice';
import { OwnScheduleDetail } from './OwnScheduleDetail';
import { OwnScheduleMaker } from './OwnScheduleMaker';
import type { OwnLanguage } from './ownScheduleWords';

export type OwnFlow =
    | { page: 'start'; cropId: string | null }
    | { page: 'detail'; chainId: string }
    | { page: 'edit'; chainId: string };

export interface OwnScheduleFlowProps {
    flow: OwnFlow;
    setFlow: (flow: OwnFlow | null) => void;
    farmId: string;
    /** The signed-in person (the server reads the authenticated person; kept for the callers). */
    userId?: string | null;
    language: OwnLanguage;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    understand?: (audio: AudioData) => Promise<PlanSpeechResult>;
    /** The back of the maker's first screen: wherever he came from (the शेड्यूल page, or planning). */
    onLeave: () => void;
    /** A save was handed to the outbox: the line to say on the planning page. */
    onSaved?: (note: string) => void;
}

export const OwnScheduleFlow: React.FC<OwnScheduleFlowProps> = ({ flow, setFlow, farmId, language, crops, farmerProfile, understand, onLeave, onSaved }) => {
    if (flow.page === 'detail') {
        return (
            <OwnScheduleDetail farmId={farmId} chainId={flow.chainId} language={language} crops={crops} farmerProfile={farmerProfile}
                onBack={() => setFlow(null)} onEdit={() => setFlow({ page: 'edit', chainId: flow.chainId })} />
        );
    }
    const saved = (note: string) => { onSaved?.(note); setFlow(null); };
    if (flow.page === 'edit') {
        return (
            <OwnScheduleMaker key={`edit-${flow.chainId}`} mode={{ kind: 'edit', chainId: flow.chainId }} farmId={farmId} language={language} crops={crops}
                farmerProfile={farmerProfile} understand={understand} onBack={() => setFlow({ page: 'detail', chainId: flow.chainId })} onSaved={saved} />
        );
    }
    return (
        <OwnScheduleMaker key="new" mode={{ kind: 'new', cropId: flow.cropId }} farmId={farmId} language={language} crops={crops}
            farmerProfile={farmerProfile} understand={understand} onBack={onLeave} onSaved={saved} />
    );
};

export default OwnScheduleFlow;
