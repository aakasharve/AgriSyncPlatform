// spec: voice-diary-e2e-2026-05-17 (D.12)
//
// Settings entry for the FullHistoryJournal consent toggle. Calls the
// existing PUT /shramsafal/consent/me endpoint with the single
// fullHistoryJournal flag (partial update is honoured per the existing
// UpdateConsentRequest contract — Phase 06.4).
//
// On the first ON transition (state.acceptedAtUtc was null OR the
// toggle was previously false), surfaces VoiceRetainedFirstGrantBanner
// to capture the explicit attestation modal flow. OFF transitions
// PUT directly without the modal.

import React, { useCallback, useState } from 'react';
import { Mic, BookOpen } from 'lucide-react';
import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';
import {
    type VoiceDiaryLocale,
    tVoiceDiary,
} from '../../i18n/voiceDiaryTranslations';
import { APP_VERSION } from '../../infrastructure/api/transport';
import { useFullHistoryJournalConsent } from '../voiceDiary/hooks/useFullHistoryJournalConsent';
import VoiceRetainedFirstGrantBanner from './VoiceRetainedFirstGrantBanner';

interface Props {
    locale: VoiceDiaryLocale;
    /** Click handler that navigates to the Voice Diary page. */
    onOpenVoiceDiary?: () => void;
}

const VoiceRetainedConsentToggle: React.FC<Props> = ({ locale, onOpenVoiceDiary }) => {
    const { granted, loaded, state, reload } = useFullHistoryJournalConsent();
    const [showFirstGrant, setShowFirstGrant] = useState(false);
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const persistConsent = useCallback(
        async (nextValue: boolean) => {
            setSaving(true);
            try {
                await agriSyncClient.updateConsent({
                    fullHistoryJournal: nextValue,
                    languageShown: locale,
                    consentTextVersion: state.version,
                    clientAppVersion: APP_VERSION,
                });
                await reload();
            } finally {
                setSaving(false);
            }
        },
        [locale, reload, state.version],
    );

    const handleChange = useCallback(
        async (nextValue: boolean) => {
            // First grant — the toggle was OFF AND no acceptedAtUtc yet. Capture
            // the explicit attestation modal before posting the grant.
            if (nextValue && !granted) {
                setShowFirstGrant(true);
                return;
            }
            // Toggle OFF (or subsequent ON after revoke) — no modal, just persist.
            await persistConsent(nextValue);
        },
        [granted, persistConsent],
    );

    const onFirstGrantConfirm = useCallback(async () => {
        await persistConsent(true);
        setShowFirstGrant(false);
    }, [persistConsent]);

    const onFirstGrantDismiss = useCallback(() => {
        setShowFirstGrant(false);
    }, []);

    return (
        <>
            <div
                id="voice-retained-consent-toggle"
                data-testid="voice-retained-consent-toggle"
                className="glass-panel p-5"
            >
                <label className="flex items-start gap-4 cursor-pointer">
                    <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-700 shadow-sm shrink-0">
                        <Mic size={22} strokeWidth={2.5} />
                    </div>
                    <input
                        type="checkbox"
                        checked={granted}
                        disabled={!loaded || saving}
                        onChange={(e) => void handleChange(e.target.checked)}
                        aria-label={tVoiceDiary(locale, 'consentToggle.title')}
                        data-testid="voice-retained-consent-checkbox"
                        className="mt-1.5 h-5 w-5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="flex-1 min-w-0">
                        <div className="font-['Noto_Sans_Devanagari'] font-bold text-base text-stone-800">
                            {tVoiceDiary(locale, 'consentToggle.title')}
                        </div>
                        <div className="font-['DM_Sans'] text-sm font-bold text-stone-500 mt-0.5">
                            {tVoiceDiary(locale, 'consentToggle.titleEn')}
                        </div>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                setExpanded(p => !p);
                            }}
                            data-testid="voice-retained-consent-expand"
                            className="mt-2 text-xs font-['DM_Sans'] font-bold text-emerald-700 hover:text-emerald-900"
                        >
                            {tVoiceDiary(locale, 'consentToggle.expand')}
                        </button>
                        {expanded && (
                            <div className="mt-2 space-y-1 text-sm text-stone-600 leading-relaxed">
                                <p className="font-['Noto_Sans_Devanagari']">
                                    {tVoiceDiary(locale, 'consentToggle.helper')}
                                </p>
                                <p className="font-['DM_Sans'] text-xs text-stone-500">
                                    {tVoiceDiary(locale, 'consentToggle.helperEn')}
                                </p>
                            </div>
                        )}
                        {onOpenVoiceDiary && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    onOpenVoiceDiary();
                                }}
                                data-testid="voice-retained-open-diary"
                                className="mt-3 inline-flex items-center gap-1.5 text-xs font-['DM_Sans'] font-bold text-emerald-700 hover:text-emerald-900"
                            >
                                <BookOpen size={14} />
                                {tVoiceDiary(locale, 'page.title')}
                            </button>
                        )}
                    </div>
                </label>
            </div>
            {showFirstGrant && (
                <VoiceRetainedFirstGrantBanner
                    locale={locale}
                    saving={saving}
                    onConfirm={onFirstGrantConfirm}
                    onDismiss={onFirstGrantDismiss}
                />
            )}
        </>
    );
};

export default VoiceRetainedConsentToggle;
