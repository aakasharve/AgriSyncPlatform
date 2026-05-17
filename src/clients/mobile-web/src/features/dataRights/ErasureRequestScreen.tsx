// spec: data-principle-spine-2026-05-05/08.6
//
// DPDP §12 self-serve erasure screen. Confirm dialog + Submit button.
// On submit, POST /shramsafal/me/erasure/request. On 202, show the
// LRP-tagged 48h SLA copy from dataRightsTranslations.

import React, { useCallback, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import {
    toDataRightsLocale,
    tDataRights,
    type DataRightsLocale,
} from '../../i18n/dataRightsTranslations';

interface Props {
    onBack?: () => void;
    /** Test seam — lets the spec inject a deterministic locale. */
    forceLocale?: DataRightsLocale;
    /** Test seam — allows tests to inject a fetch mock. */
    submitFn?: () => Promise<{ requestId: string }>;
}

type SubmitStatus = 'idle' | 'confirming' | 'submitting' | 'success' | 'error';

async function defaultSubmit(): Promise<{ requestId: string }> {
    const res = await fetch('/shramsafal/me/erasure/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok && res.status !== 202) {
        throw new Error(`erasure request failed: ${res.status}`);
    }
    const body = await res.json().catch(() => ({}));
    return { requestId: body?.requestId ?? '' };
}

const ErasureRequestScreen: React.FC<Props> = ({ onBack, forceLocale, submitFn }) => {
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

    const title = tDataRights(locale, 'erasure.title');
    const intro = tDataRights(locale, 'erasure.intro');
    const confirmHeading = tDataRights(locale, 'erasure.confirmHeading');
    const confirmBody = tDataRights(locale, 'erasure.confirmBody');
    const submitLabel = tDataRights(locale, 'erasure.submit');
    const cancelLabel = tDataRights(locale, 'erasure.cancel');
    const slaLabel = tDataRights(locale, 'erasure.sla');
    const errorLabel = tDataRights(locale, 'erasure.error');

    return (
        <div
            className="space-y-4 pb-24 px-4"
            data-testid="erasure-request-screen"
            data-data-rights-locale={locale}
        >
            <div className="pt-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="text-sm font-bold text-stone-500 hover:text-stone-700 mb-3"
                    data-testid="erasure-back"
                >
                    ←
                </button>
                <h1 className="text-2xl font-display font-black text-stone-900">{title}</h1>
                <p className="text-sm text-stone-600 mt-2 leading-relaxed">{intro}</p>
            </div>

            {status === 'idle' && (
                <div className="pt-4">
                    <button
                        type="button"
                        onClick={() => setStatus('confirming')}
                        className="w-full py-3 px-4 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 active:scale-95"
                        data-testid="erasure-open-confirm"
                    >
                        {submitLabel}
                    </button>
                </div>
            )}

            {status === 'confirming' && (
                <div className="pt-4 glass-panel p-4 space-y-3" data-testid="erasure-confirm-dialog">
                    <h2 className="text-lg font-display font-black text-red-700">{confirmHeading}</h2>
                    <p className="text-sm text-stone-700 leading-relaxed">{confirmBody}</p>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={submit}
                            className="flex-1 py-3 px-4 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700"
                            data-testid="erasure-confirm-submit"
                        >
                            {submitLabel}
                        </button>
                        <button
                            type="button"
                            onClick={() => setStatus('idle')}
                            className="flex-1 py-3 px-4 rounded-xl bg-stone-200 text-stone-800 font-bold hover:bg-stone-300"
                            data-testid="erasure-confirm-cancel"
                        >
                            {cancelLabel}
                        </button>
                    </div>
                </div>
            )}

            {status === 'submitting' && (
                <p className="text-sm text-stone-500" data-testid="erasure-submitting">
                    ...
                </p>
            )}

            {status === 'success' && (
                <div className="pt-4 glass-panel p-4 bg-emerald-50">
                    <p
                        className="text-sm font-bold text-emerald-800"
                        data-testid="erasure-success-sla"
                    >
                        {slaLabel}
                    </p>
                </div>
            )}

            {status === 'error' && (
                <p
                    className="text-sm font-bold text-red-700"
                    data-testid="erasure-error"
                >
                    {errorLabel}
                </p>
            )}
        </div>
    );
};

export default ErasureRequestScreen;
