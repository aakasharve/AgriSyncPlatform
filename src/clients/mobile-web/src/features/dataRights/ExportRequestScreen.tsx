// spec: data-principle-spine-2026-05-05/08.6
//
// DPDP §11 self-serve export screen. Submit button. On submit, POST
// /shramsafal/me/export/request. On 202, show the LRP-tagged 24h SLA
// copy from dataRightsTranslations.

import React, { useCallback, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { apiFetch } from '../../infrastructure/api/apiFetch';
import {
    toDataRightsLocale,
    tDataRights,
    type DataRightsLocale,
} from '../../i18n/dataRightsTranslations';
import { PageBar } from '../../shared/components/ui/placeUi';

interface Props {
    onBack?: () => void;
    forceLocale?: DataRightsLocale;
    submitFn?: () => Promise<{ requestId: string }>;
    /** spec: plr-d10 (I17) — a section of the one "गोपनीयता व संमती" page (which owns the title bar). */
    embedded?: boolean;
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

// `apiFetch`, not `fetch` — see ErasureRequestScreen for the full reason. A bare
// relative fetch reached the WebView instead of the API in the APK, and sent no
// Authorization header to an endpoint declared .RequireAuthorization().
async function defaultSubmit(): Promise<{ requestId: string }> {
    const res = await apiFetch('/shramsafal/me/export/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok && res.status !== 202) {
        throw new Error(`export request failed: ${res.status}`);
    }
    const body = await res.json().catch(() => ({}));
    return { requestId: body?.requestId ?? '' };
}

const ExportRequestScreen: React.FC<Props> = ({ onBack, forceLocale, submitFn, embedded = false }) => {
    const { language } = useLanguage();
    const locale = forceLocale ?? toDataRightsLocale(language);
    const [status, setStatus] = useState<SubmitStatus>('idle');

    const submit = useCallback(async () => {
        setStatus('submitting');
        try {
            await (submitFn ?? defaultSubmit)();
            setStatus('success');
        } catch {
            setStatus('error');
        }
    }, [submitFn]);

    const title = tDataRights(locale, 'export.title');
    const intro = tDataRights(locale, 'export.intro');
    const submitLabel = tDataRights(locale, 'export.submit');
    const slaLabel = tDataRights(locale, 'export.sla');
    const errorLabel = tDataRights(locale, 'export.error');

    return (
        <div
            className={`space-y-4 ${embedded ? '' : 'pb-24'}`}
            data-testid="export-request-screen"
            data-data-rights-locale={locale}
        >
            {/* spec: plr-d10 (I17, H19) — the one title bar with one big मागे (was a bare "←"). */}
            {embedded
                ? <h3 className="m-0 text-[16px] font-extrabold text-stone-900">{title}</h3>
                : <PageBar title={title} onBack={onBack} />}
            <p className="text-sm text-stone-600 leading-relaxed">{intro}</p>

            <div>
                <button
                    type="button"
                    onClick={submit}
                    disabled={status === 'submitting' || status === 'success'}
                    className="w-full py-3 px-4 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 active:scale-95"
                    data-testid="export-submit-button"
                >
                    {submitLabel}
                </button>
            </div>

            {status === 'success' && (
                <div className="pt-4 glass-panel p-4 bg-emerald-50">
                    <p
                        className="text-sm font-bold text-emerald-800"
                        data-testid="export-success-sla"
                    >
                        {slaLabel}
                    </p>
                </div>
            )}

            {status === 'error' && (
                <p className="text-sm font-bold text-red-700" data-testid="export-error">
                    {errorLabel}
                </p>
            )}
        </div>
    );
};

export default ExportRequestScreen;
