/**
 * MinimalOnboarding — the screen a signed-in person with 0 farms sees.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-3 / MU-1, FR-8, LANG-2) — it opens on
 * two EQUAL doors (`FirstFarmDoors`): "माझं शेत सुरू करायचं" or "मला बोलावलं आहे". The first opens the
 * farm-name card (`FarmNameCard`, repair R3 lane S2 = the founder's pick V6a-B): "तुमच्या शेताचं नाव काय
 * आहे?", then — once the server answered "created" — the congratulations in the same card. In ONE language,
 * with ONE "← मागे" back to the doors. The second opens the ONE join door (`JoinByCodeScreen`, via
 * `onJoinViaQr`). There is no role question anywhere; a joiner's role is the owner's call.
 *
 * API: POST /bootstrap/first-farm  { farmName }
 *   → BootstrapFirstFarmResponse.farmId drives the completion callback (after "सुरू करूया").
 *
 * Spec: getmyfarms-user-scoped-rls-read-path-2026-06-06
 */

import React, { useEffect, useState } from 'react';
import { type BootstrapFirstFarmResponse } from '../qr/inviteApi';
import { type WaitingSeat } from './PendingJoinRequests';
import FirstFarmDoors from './FirstFarmDoors';
import FarmNameCard from './FarmNameCard';
import { WaitingInvitations } from '../../invitations/WaitingInvitations';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

interface MinimalOnboardingProps {
    isOpen: boolean;
    onComplete: (result: BootstrapFirstFarmResponse) => void;
    onJoinViaQr: () => void;
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F2) — seats that grant nothing yet: farms this
     * person asked to join (typed code) that the owner has not approved, or a paused seat. He
     * still has no farm, so this screen stays; it says what each one is (a request waiting, or
     * work paused — never one for the other) instead of looking as if nothing happened.
     */
    pendingSeats?: WaitingSeat[];
    /** Withdraws a waiting request (server self-exit) and refreshes the farm lists. */
    onWithdrawRequest?: (farmId: string) => Promise<void>;
    /** Back from the doors to the phone number (signs out). Not drawn without it. */
    onBack?: () => void;
    /** spec: plr-d10 lane MU-2 — an invitation was answered (in at once, or a request): the caller refreshes his farms. */
    onInvitationAnswered?: () => void;
}

const MinimalOnboarding: React.FC<MinimalOnboardingProps> = ({
    isOpen,
    onComplete,
    onJoinViaQr,
    pendingSeats = [],
    onWithdrawRequest,
    onBack,
    onInvitationAnswered,
}) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const [step, setStep] = useState<'doors' | 'create'>('doors');

    // Every opening starts at the two doors (the card starts empty: it mounts afresh).
    useEffect(() => {
        if (isOpen) setStep('doors');
    }, [isOpen]);

    if (!isOpen) return null;

    if (step === 'doors') {
        return (
            <FirstFarmDoors
                onStartOwnFarm={() => setStep('create')}
                onJoin={onJoinViaQr}
                onBack={onBack}
                pendingSeats={pendingSeats}
                onWithdrawRequest={onWithdrawRequest}
                invitations={<WaitingInvitations onAnswered={onInvitationAnswered} />}
            />
        );
    }

    return <FarmNameCard language={language} onBack={() => setStep('doors')} onDone={onComplete} />;
};

export default MinimalOnboarding;
