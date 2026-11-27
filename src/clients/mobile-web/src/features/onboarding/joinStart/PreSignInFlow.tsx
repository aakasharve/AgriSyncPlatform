/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — everything a person meets after स्वागत and
 * before he is signed in: the first questions (`JoinStartFlow`), then the number and the SMS code (`LoginPage`, the
 * permissions page opening before the code is sent). Back from the number returns to the step he left from.
 *
 *   "आधीच श्रमसफल वापरता? लॉगिन करा" → the number, nothing carried over;
 *   "नाही, मी स्वतः सुरू करतोय"      → the number; after sign-in a person with no farm goes straight to making his own;
 *   a scanned QR / a typed code       → the number, with the code shown; after sign-in the app sends it once.
 *
 * The founder's own number works through every one of these (he tests as himself): an existing account simply signs in;
 * a code he types for a farm he already holds is answered "you are already on this farm" by the server.
 */
import React, { useState } from 'react';
import LoginPage from '../../../pages/LoginPage';
import JoinStartFlow, { type JoinStartChoice, type JoinStartStep } from './JoinStartFlow';
import { dropJoinStartChoices, holdJoin, holdOwnFarmStart, type HeldJoin } from './heldJoin';

const stepToReturnTo = (choice: JoinStartChoice): JoinStartStep =>
    choice.kind === 'login' ? 'who' : choice.kind === 'own' ? 'invited' : choice.held.kind === 'qr' ? 'scan' : 'code';

const PreSignInFlow: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const [choice, setChoice] = useState<JoinStartChoice | null>(null);
    const [returnTo, setReturnTo] = useState<JoinStartStep>('who');

    if (!choice) {
        return (
            <JoinStartFlow
                key={returnTo}
                initialStep={returnTo}
                onBack={onBack}
                onChoice={(next) => {
                    if (next.kind === 'join') holdJoin(next.held);
                    else if (next.kind === 'own') holdOwnFarmStart();
                    else dropJoinStartChoices();
                    setReturnTo(stepToReturnTo(next));
                    setChoice(next);
                }}
            />
        );
    }

    const held: HeldJoin | undefined = choice.kind === 'join' ? choice.held : undefined;
    return (
        <LoginPage
            heldJoin={held}
            onBack={() => {
                dropJoinStartChoices();
                setChoice(null);
            }}
        />
    );
};

export default PreSignInFlow;
