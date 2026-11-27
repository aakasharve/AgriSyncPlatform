// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A)
//
// The permissions page where a phone-number screen used to draw its consent tick: drawn only while the consent step
// (`useConsentBeforeOtp`) has it open - that is, after he tapped send and before his number leaves the phone.

import React from 'react';
import type { ConsentBeforeOtp } from '../gate/useConsentBeforeOtp';
import PermissionsPage from './PermissionsPage';

const PermissionsPageGate: React.FC<{ consent: ConsentBeforeOtp }> = ({ consent }) => {
    if (!consent.pageOpen) return null;
    return (
        <PermissionsPage
            language={consent.language}
            onLanguage={consent.setLanguage}
            recording={consent.recording}
            onAccept={consent.accept}
            onDecline={consent.decline}
        />
    );
};

export default PermissionsPageGate;
