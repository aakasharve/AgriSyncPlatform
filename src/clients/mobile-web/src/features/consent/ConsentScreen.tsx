// spec: data-principle-spine-2026-05-05/06.4
//
// Consent screen — three independent toggles (default OFF), expandable
// agreement, Save + Revoke-all. Mounted at `/settings/consent` (Phase
// 06.4 §Frontend modify list). PUT to `/shramsafal/consent/me` via
// `agriSyncClient.updateConsent`; refreshes from `GET /shramsafal/consent/me`
// on mount.
//
// Per V2 §B.1 and plan §6.4.4: voice-playback narration is explicitly
// DEFERRED — the empty `<audio data-narration-pending>` element below
// reserves layout so a follow-up PR can drop the narration script in
// without re-flowing the screen.
//
// Every legal string surfaces through `tConsent` / the served markdown files.
//
// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36, D-31) — the three
// permissions are now: keep my original voice (D-31 words), the OPTIONAL improvement
// permission (D-36, its own server record), and research. The old "improve the app using my
// de-identified data" switch (crossFarmAggregation) is no longer drawn: D-36 says an ambiguous
// old switch must not count as the improvement permission, and nothing reads it. Its stored
// value is left exactly as it is, and "revoke all" still turns it off.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';
import {
    toConsentLocale,
    tConsent,
    type ConsentLocale,
} from '../../i18n/consentTranslations';
import { useLanguage } from '../../i18n/LanguageContext';
import { ConsentState } from '../../domain/consent/ConsentState';
import ConsentAgreement from './ConsentAgreement';
import ConsentToggle, { type ConsentToggleId } from './ConsentToggle';
import RevokeAllButton from './RevokeAllButton';
import { APP_VERSION } from '../../infrastructure/api/transport';
import { PageBar } from '../../shared/components/ui/placeUi';
import ImprovementPermissionToggle from './improvement/ImprovementPermissionToggle';
import {
    IMPROVEMENT_WORDING_VERSION,
    VOICE_RETENTION_WORDING_VERSION,
} from './improvement/improvementPermissionCopy';

interface Props {
    onBack?: () => void;
    /** Test seam — lets the spec inject a deterministic locale. */
    forceLocale?: ConsentLocale;
    /**
     * spec: plr-d10 (I17) — drawn inside the one "गोपनीयता व संमती" page, which owns the single title
     * bar: no title bar of its own here. Only the look changes; every consent word stays as it is.
     */
    embedded?: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

const ConsentScreen: React.FC<Props> = ({ onBack, forceLocale, embedded = false }) => {
    const { language } = useLanguage();
    const locale: ConsentLocale = forceLocale ?? toConsentLocale(language);

    const [state, setState] = useState<ConsentState>(() => ConsentState.default());
    const [loaded, setLoaded] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
    // What the server holds, so a save sends only the choices he actually changed.
    const stored = useRef<{ fullHistoryJournal: boolean; improvement: boolean }>({
        fullHistoryJournal: false,
        improvement: false,
    });
    // The improvement permission: ON only when he agreed to THESE words. null = not readable,
    // so the switch is held (it cannot show the truth).
    const [improvement, setImprovement] = useState<boolean | null>(null);

    // ----- Load current consent state on mount --------------------------
    useEffect(() => {
        let cancelled = false;
        agriSyncClient
            .getConsent()
            .then((dto) => {
                if (cancelled) return;
                setState({
                    fullHistoryJournal: dto.fullHistoryJournal,
                    crossFarmAggregation: dto.crossFarmAggregation,
                    researchCorpusExport: dto.researchCorpusExport,
                    version: dto.version,
                    acceptedAtUtc: dto.acceptedAtUtc,
                    revokedAtUtc: dto.revokedAtUtc,
                });
                stored.current = { ...stored.current, fullHistoryJournal: dto.fullHistoryJournal };
                setLoaded(true);
            })
            .catch(() => {
                // No prior consent on the server, or the endpoint is
                // not yet live (06.2 backend in parallel). Render with
                // defaults — all OFF — so the user can submit a fresh
                // consent decision.
                if (!cancelled) setLoaded(true);
            });
        agriSyncClient
            .getImprovementPermission()
            .then((dto) => {
                if (cancelled) return;
                const mine = dto.allowed && dto.wordingVersion === IMPROVEMENT_WORDING_VERSION;
                stored.current = { ...stored.current, improvement: mine };
                setImprovement(mine);
            })
            .catch(() => {
                // Unreadable: the switch stays held rather than showing an OFF that may be false.
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const setToggle = useCallback((id: ConsentToggleId, value: boolean) => {
        setState((prev) => ({ ...prev, [id]: value }));
        setSaveStatus('idle');
    }, []);

    const save = useCallback(
        async (override?: Partial<ConsentState>, improvementOverride?: boolean) => {
            const next = { ...state, ...(override ?? {}) };
            // An explicit improvementOverride is ALWAYS sent (revoke all); otherwise only a change is.
            const forceImprovement = improvementOverride !== undefined;
            const nextImprovement = improvementOverride ?? improvement;
            setSaveStatus('saving');
            try {
                // D-31: name the words only when the "keep my original voice" choice is being made.
                const voiceChoiceMade = next.fullHistoryJournal !== stored.current.fullHistoryJournal;
                const result = await agriSyncClient.updateConsent({
                    fullHistoryJournal: next.fullHistoryJournal,
                    // The retired switch is sent only to turn it OFF (revoke all); otherwise left as is.
                    ...(override?.crossFarmAggregation === false ? { crossFarmAggregation: false } : {}),
                    researchCorpusExport: next.researchCorpusExport,
                    languageShown: locale,
                    consentTextVersion: next.version,
                    clientAppVersion: APP_VERSION,
                    ...(voiceChoiceMade ? { fullHistoryJournalWordingVersion: VOICE_RETENTION_WORDING_VERSION } : {}),
                });
                stored.current = { ...stored.current, fullHistoryJournal: result.fullHistoryJournal };
                // D-36: the improvement permission is its own record, sent when it changed — or
                // always, when the caller forces it. A failed send lands in the catch below: the
                // success line is never shown for a withdrawal that did not reach the server.
                if (nextImprovement !== null
                    && (forceImprovement || nextImprovement !== stored.current.improvement)) {
                    const saved = await agriSyncClient.setImprovementPermission({
                        allowed: nextImprovement,
                        wordingVersion: IMPROVEMENT_WORDING_VERSION,
                        languageShown: locale === 'mr-IN' ? 'mr' : 'en',
                    });
                    const mine = saved.allowed && saved.wordingVersion === IMPROVEMENT_WORDING_VERSION;
                    stored.current = { ...stored.current, improvement: mine };
                    setImprovement(mine);
                }
                setState({
                    fullHistoryJournal: result.fullHistoryJournal,
                    crossFarmAggregation: result.crossFarmAggregation,
                    researchCorpusExport: result.researchCorpusExport,
                    version: result.version,
                    acceptedAtUtc: result.acceptedAtUtc,
                    revokedAtUtc: result.revokedAtUtc,
                });
                setSaveStatus('success');
            } catch {
                setSaveStatus('error');
            }
        },
        [state, locale, improvement],
    );

    const onRevokeAll = useCallback(async () => {
        await save(
            {
                fullHistoryJournal: false,
                crossFarmAggregation: false,
                researchCorpusExport: false,
            },
            // Withdrawing everything includes the improvement permission (D-36: withdrawal
            // stops future selection). ALWAYS sent — even when the page could not read what the
            // server holds, because "revoke all" must never leave an ON behind.
            false,
        );
    }, [save]);

    const saveLabel = tConsent(locale, 'save.button');
    const saveSuccessLabel = tConsent(locale, 'save.success');
    const saveErrorLabel = tConsent(locale, 'save.error');
    const title = tConsent(locale, 'screen.title');
    const intro = tConsent(locale, 'screen.intro');
    const expandLabel = tConsent(locale, 'toggles.expand');

    const status = useMemo(() => {
        if (saveStatus === 'success') return { text: saveSuccessLabel, cls: 'text-emerald-700' };
        if (saveStatus === 'error') return { text: saveErrorLabel, cls: 'text-red-600' };
        return null;
    }, [saveStatus, saveSuccessLabel, saveErrorLabel]);

    return (
        <div
            className={`space-y-4 ${embedded ? '' : 'pb-24'}`}
            data-testid="consent-screen"
            // The locale attribute makes the rendered language easy to read off a
            // Sentry/Replay snapshot.
            data-consent-locale={locale}
        >
            {/* spec: plr-d10 (I17, H19) — the one title bar with one big मागे (was a bare "←"). */}
            {!embedded && <PageBar title={title} onBack={onBack} />}
            <p className="text-sm text-stone-600 leading-relaxed">{intro}</p>

            {/* Voice narration placeholder — populated by a follow-up PR
                (counsel-approved script). Keeps layout stable. */}
            <audio
                data-narration-pending="true"
                data-testid="consent-narration-pending"
                aria-hidden="true"
                preload="none"
                className="hidden"
            />

            {loaded && (
                <>
                    <ConsentToggle
                        toggleId="fullHistoryJournal"
                        meaning={tConsent(locale, 'toggles.fullHistoryJournal.meaning')}
                        value={state.fullHistoryJournal}
                        onChange={(v) => setToggle('fullHistoryJournal', v)}
                        locale={locale}
                    />
                    <ImprovementPermissionToggle
                        language={locale === 'mr-IN' ? 'mr' : 'en'}
                        checked={improvement === true}
                        disabled={improvement === null || saveStatus === 'saving'}
                        onChange={(v) => {
                            setImprovement(v);
                            setSaveStatus('idle');
                        }}
                    />
                    <ConsentToggle
                        toggleId="researchCorpusExport"
                        value={state.researchCorpusExport}
                        onChange={(v) => setToggle('researchCorpusExport', v)}
                        locale={locale}
                    />
                </>
            )}

            <div className="pt-2">
                <button
                    type="button"
                    onClick={() => setAgreementOpen((p) => !p)}
                    className="text-xs font-bold text-emerald-700 underline"
                    data-testid="consent-agreement-toggle"
                >
                    {agreementOpen ? '−' : '+'} {expandLabel}
                </button>
                {agreementOpen && (
                    <div className="mt-3 glass-panel p-4">
                        <ConsentAgreement locale={locale} />
                    </div>
                )}
            </div>

            <div className="pt-4 space-y-3">
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saveStatus === 'saving'}
                    className="w-full py-3 px-4 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
                    data-testid="consent-save-button"
                >
                    {saveLabel}
                </button>
                {status && (
                    <p
                        className={`text-sm text-center font-bold ${status.cls}`}
                        data-testid="consent-save-status"
                    >
                        {status.text}
                    </p>
                )}
                <RevokeAllButton
                    locale={locale}
                    onConfirm={onRevokeAll}
                    disabled={saveStatus === 'saving'}
                />
            </div>
        </div>
    );
};

export default ConsentScreen;
