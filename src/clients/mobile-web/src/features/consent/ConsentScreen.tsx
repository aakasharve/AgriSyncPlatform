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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
                setLoaded(true);
            })
            .catch(() => {
                // No prior consent on the server, or the endpoint is
                // not yet live (06.2 backend in parallel). Render with
                // defaults — all OFF — so the user can submit a fresh
                // consent decision.
                if (!cancelled) setLoaded(true);
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
        async (override?: Partial<ConsentState>) => {
            const next = { ...state, ...(override ?? {}) };
            setSaveStatus('saving');
            try {
                const result = await agriSyncClient.updateConsent({
                    fullHistoryJournal: next.fullHistoryJournal,
                    crossFarmAggregation: next.crossFarmAggregation,
                    researchCorpusExport: next.researchCorpusExport,
                    languageShown: locale,
                    consentTextVersion: next.version,
                    clientAppVersion: APP_VERSION,
                });
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
        [state, locale],
    );

    const onRevokeAll = useCallback(async () => {
        await save({
            fullHistoryJournal: false,
            crossFarmAggregation: false,
            researchCorpusExport: false,
        });
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
                        value={state.fullHistoryJournal}
                        onChange={(v) => setToggle('fullHistoryJournal', v)}
                        locale={locale}
                    />
                    <ConsentToggle
                        toggleId="crossFarmAggregation"
                        value={state.crossFarmAggregation}
                        onChange={(v) => setToggle('crossFarmAggregation', v)}
                        locale={locale}
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
