/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I17) — "गोपनीयता व संमती" as ONE place, as decided
 * in PLR-D9 §6 (line 106: "गोपनीयता व संमती with export and erase-with-confirm") and drawn in the preview
 * (`app/HubPages.tsx` PrivacyPage): one title bar with one मागे, the three consents (each OFF until he
 * turns it on), then his data — ask for a copy, and erase behind its own "are you sure" step.
 *
 * It only arranges the REAL screens: the consent screen (its words, version and save are unchanged — the
 * consent text and its hash must not change, PLR-D10 Global Constraints) and the two data-rights requests
 * (the same server calls). The old separate routes stay for anyone who opens them directly.
 */
import React from 'react';
import ConsentScreen from '../consent/ConsentScreen';
import ExportRequestScreen from '../dataRights/ExportRequestScreen';
import ErasureRequestScreen from '../dataRights/ErasureRequestScreen';
import { GlassCard, PageBar, SANS, SectionHead } from '../../shared/components/ui/placeUi';
import { PRIVACY_TITLE } from './settingsItems';

const PrivacyAndConsentPage: React.FC<{ onBack: () => void }> = ({ onBack }) => (
    <div className="space-y-3 pb-24" style={{ fontFamily: SANS }} data-testid="privacy-page">
        <PageBar title={PRIVACY_TITLE} onBack={onBack} />
        <ConsentScreen embedded />
        {/* PROPOSED (Marathi): "माझा डेटा" — the preview's heading for the copy / erase group. */}
        <SectionHead title="माझा डेटा" />
        <GlassCard testId="privacy-export">
            <ExportRequestScreen embedded />
        </GlassCard>
        <GlassCard testId="privacy-erase">
            <ErasureRequestScreen embedded />
        </GlassCard>
    </div>
);

export default PrivacyAndConsentPage;
