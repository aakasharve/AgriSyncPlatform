// spec: voice-diary-e2e-2026-05-17 (D.12)
//
// Settings entry for the FullHistoryJournal consent toggle. Calls the
// existing PUT /shramsafal/consent/me endpoint with the single
// fullHistoryJournal flag (partial update is honoured per the existing
// UpdateConsentRequest contract — Phase 06.4).
//
// On the first ON transition (state.acceptedAtUtc was null OR the
// toggle was previously false), surfaces VoiceRetainedFirstGrantBanner
// to capture the explicit attestation modal flow.
//
// spec: dfes-companion-2026-07-11 (farm-memory) — ADR-DS-017 (c).
// OFF transitions used to PUT directly, with no modal at all. Granting
// was a considered act and revoking was one careless tap, which is the
// wrong way round: OFF is the direction with consequences. It now goes
// through VoiceRetainedStopFutureBanner, whose job is to state the thing
// the farmer cannot otherwise know from a checkbox — that this stops
// FUTURE saving and leaves everything already saved alone.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, BookOpen } from 'lucide-react';
import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';
import {
    type VoiceDiaryLocale,
    tVoiceDiary,
} from '../../i18n/voiceDiaryTranslations';
import { APP_VERSION } from '../../infrastructure/api/transport';
import { VOICE_RETENTION_WORDING_VERSION } from './improvement/improvementPermissionCopy';
import {
    useFullHistoryJournalConsent,
    type UseFullHistoryJournalConsentResult,
} from '../voiceDiary/hooks/useFullHistoryJournalConsent';
import VoiceRetainedFirstGrantBanner from './VoiceRetainedFirstGrantBanner';
import VoiceRetainedStopFutureBanner from './VoiceRetainedStopFutureBanner';

interface Props {
    locale: VoiceDiaryLocale;
    /** Click handler that navigates to the Voice Diary page. */
    onOpenVoiceDiary?: () => void;
}

/**
 * spec: plr-d10 (I17, PLR-D9 O8) — the toggle drawn from a consent answer the CALLER already holds.
 * The recordings page (आवाज नोंदी) shows this switch itself and passes its own answer, so the page's
 * banner and the switch can never disagree after a change (one read, one `reload`).
 *
 * `turnOnRequest`: the page's own "चालू करा" button. Each new value asks to turn saving ON exactly as
 * ticking this switch does — the same first-grant confirmation opens, and nothing is saved until he
 * says "मी सहमत आहे". (It used to only scroll to this switch, so "turn on" turned nothing on.)
 */
export const VoiceRetainedConsentToggleView: React.FC<Props & {
    consent: UseFullHistoryJournalConsentResult;
    turnOnRequest?: number;
}> = ({
    locale, onOpenVoiceDiary, consent, turnOnRequest = 0,
}) => {
    const { granted, loaded, state, reload } = consent;
    const [showFirstGrant, setShowFirstGrant] = useState(false);
    const [showStopFuture, setShowStopFuture] = useState(false);
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState(false);

    // Only a NEW request opens the confirmation (not the first render, not a re-render).
    const lastTurnOnRequest = useRef(turnOnRequest);
    useEffect(() => {
        if (turnOnRequest === lastTurnOnRequest.current) return;
        lastTurnOnRequest.current = turnOnRequest;
        if (loaded && !granted) setShowFirstGrant(true);
    }, [turnOnRequest, loaded, granted]);

    const persistConsent = useCallback(
        async (nextValue: boolean) => {
            setSaving(true);
            try {
                await agriSyncClient.updateConsent({
                    fullHistoryJournal: nextValue,
                    languageShown: locale,
                    consentTextVersion: state.version,
                    clientAppVersion: APP_VERSION,
                    // plr-d10 I25 (founder D-31): the choice is made against THESE words.
                    fullHistoryJournalWordingVersion: VOICE_RETENTION_WORDING_VERSION,
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
            // Turning OFF — confirm, and say what it does and does not do.
            // Nothing is persisted until he confirms, so a mis-tap on the
            // checkbox changes nothing on the server.
            if (!nextValue && granted) {
                setShowStopFuture(true);
                return;
            }
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

    const onStopFutureConfirm = useCallback(async () => {
        await persistConsent(false);
        setShowStopFuture(false);
    }, [persistConsent]);

    const onStopFutureDismiss = useCallback(() => {
        setShowStopFuture(false);
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
                        {/* spec: plr-d10 (I17, V-2) — one line in his language; the English second line is gone. */}
                        <div className="font-['Noto_Sans_Devanagari'] font-bold text-base text-stone-800">
                            {tVoiceDiary(locale, 'consentToggle.title')}
                        </div>
                        {/* plr-d10 I25 (founder D-31): who may listen, always visible. */}
                        <p
                            className="mt-1 font-['Noto_Sans_Devanagari'] text-sm font-medium text-stone-700 leading-snug"
                            data-testid="voice-retained-consent-meaning"
                        >
                            {tVoiceDiary(locale, 'consentToggle.meaning')}
                        </p>
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
            {showStopFuture && (
                <VoiceRetainedStopFutureBanner
                    locale={locale}
                    saving={saving}
                    onConfirm={onStopFutureConfirm}
                    onDismiss={onStopFutureDismiss}
                />
            )}
        </>
    );
};

/** The self-contained toggle (reads the consent itself) — the Settings page uses this one. */
const VoiceRetainedConsentToggle: React.FC<Props> = (props) => {
    const consent = useFullHistoryJournalConsent();
    return <VoiceRetainedConsentToggleView {...props} consent={consent} />;
};

export default VoiceRetainedConsentToggle;
