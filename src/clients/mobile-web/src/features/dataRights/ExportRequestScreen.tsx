// spec: data-principle-spine-2026-05-05/08.6
//
// DPDP §11 self-serve export screen. Submit button. On submit, POST
// /shramsafal/me/export/request. On 202, show the LRP-tagged 24h SLA
// copy from dataRightsTranslations.

import React, { useCallback, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import {
    toDataRightsLocale,
    tDataRights,
    type DataRightsLocale,
} from '../../i18n/dataRightsTranslations';

interface Props {
    onBack?: () => void;
    forceLocale?: DataRightsLocale;
    submitFn?: () => Promise<{ requestId: string }>;
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

async function defaultSubmit(): Promise<{ requestId: string }> {
    const res = await fetch('/shramsafal/me/export/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok && res.status !== 202) {
        throw new Error(`export request failed: ${res.status}`);
    }
    const body = await res.json().catch(() => ({}));
    return { requestId: body?.requestId ?? '' };
}

const ExportRequestScreen: React.FC<Props> = ({ onBack, forceLocale, submitFn }) => {
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
            className="space-y-4 pb-24 px-4"
            data-testid="export-request-screen"
            data-data-rights-locale={locale}
        >
            <div className="pt-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="text-sm font-bold text-stone-500 hover:text-stone-700 mb-3"
                    data-testid="export-back"
                >
                    ←
                </button>
                <h1 className="text-2xl font-display font-black text-stone-900">{title}</h1>
                <p className="text-sm text-stone-600 mt-2 leading-relaxed">{intro}</p>
            </div>

            <div className="pt-4">
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
