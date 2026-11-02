// spec: data-principle-spine-2026-05-05/08.6
//
// DPDP §12 self-serve erasure screen. Confirm dialog + Submit button.
// On submit, POST /shramsafal/me/erasure/request. On 202, say when erasure starts.
//
// spec: plr-d10 lane F99 fix pass 1, item 11 (founder D-71) — the request waits 30
// days and can be cancelled until then. The screen says so before he asks, the
// answer names the day erasure starts (the server's erasureStartsAtUtc), and his
// requests are listed below with a cancel action (MyErasureRequests).
//
// lane F99 fix pass 2 (review N-1): while his request waits, the screen shows THAT request (its date and "विनंती
// रद्द करा") in place of a new "erase" button, so a second tap cannot make a second request he would not know to cancel
// (the server also answers a second ask with the same request).

import React, { useCallback, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { apiFetch } from '../../infrastructure/api/apiFetch';
import {
    formatDataRightsDate,
    toDataRightsLocale,
    tDataRights,
    type DataRightsLocale,
} from '../../i18n/dataRightsTranslations';
import { PageBar } from '../../shared/components/ui/placeUi';
import MyErasureRequests from './MyErasureRequests';
import { useMyErasureRequests, waitingRequestFor } from './useMyErasureRequests';

interface Props {
    onBack?: () => void;
    /** Test seam — lets the spec inject a deterministic locale. */
    forceLocale?: DataRightsLocale;
    /** Test seam — allows tests to inject a fetch mock. */
    submitFn?: () => Promise<{ requestId: string; erasureStartsAtUtc?: string | null }>;
    /** spec: plr-d10 (I17) — a section of the one "गोपनीयता व संमती" page (which owns the title bar). */
    embedded?: boolean;
}

type SubmitStatus = 'idle' | 'confirming' | 'submitting' | 'success' | 'error';

// `apiFetch`, not `fetch`. This used to be a bare relative fetch, which in the
// APK asked the WebView (https://localhost) instead of the API, and carried no
// Authorization header for an endpoint declared .RequireAuthorization(). So
// self-serve erasure was inert on every phone — the one DPDP right the screen
// exists to deliver, and something Google Play requires to work.
async function defaultSubmit(): Promise<{ requestId: string; erasureStartsAtUtc?: string | null }> {
    const res = await apiFetch('/shramsafal/me/erasure/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok && res.status !== 202) {
        throw new Error(`erasure request failed: ${res.status}`);
    }
    const body = await res.json().catch(() => ({}));
    // D-71: the server says when erasure starts (absent from an older server: the 30-day sentence is shown instead).
    return { requestId: body?.requestId ?? '', erasureStartsAtUtc: body?.erasureStartsAtUtc ?? null };
}

const ErasureRequestScreen: React.FC<Props> = ({ onBack, forceLocale, submitFn, embedded = false }) => {
    const { language } = useLanguage();
    const locale = forceLocale ?? toDataRightsLocale(language);
    const [status, setStatus] = useState<SubmitStatus>('idle');
    const [startsAt, setStartsAt] = useState<string | null>(null);
    const [listKey, setListKey] = useState(0);
    const requests = useMyErasureRequests(listKey);
    const waiting = waitingRequestFor(requests.rows);

    const submit = useCallback(async () => {
        setStatus('submitting');
        try {
            const answer = await (submitFn ?? defaultSubmit)();
            setStartsAt(answer?.erasureStartsAtUtc ?? null);
            setStatus('success');
            setListKey(k => k + 1);
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
    const waitLabel = tDataRights(locale, 'erasure.wait');
    const startsOn = formatDataRightsDate(locale, startsAt);
    const slaLabel = startsOn
        ? tDataRights(locale, 'erasure.slaWithDate').replace('{date}', startsOn)
        : tDataRights(locale, 'erasure.sla');
    const errorLabel = tDataRights(locale, 'erasure.error');
    const waitingLabel = waiting
        ? tDataRights(locale, 'erasure.waitingNow').replace('{date}', formatDataRightsDate(locale, waiting.erasureStartsAtUtc))
        : '';

    return (
        <div
            className={`space-y-4 ${embedded ? '' : 'pb-24'}`}
            data-testid="erasure-request-screen"
            data-data-rights-locale={locale}
        >
            {/* spec: plr-d10 (I17, H19) — the one title bar with one big मागे (was a bare "←"). */}
            {embedded
                ? <h3 className="m-0 text-[16px] font-extrabold text-stone-900">{title}</h3>
                : <PageBar title={title} onBack={onBack} />}
            <p className="text-sm text-stone-600 leading-relaxed">{intro}</p>
            <p className="text-sm font-semibold text-stone-800 leading-relaxed" data-testid="erasure-wait-note">{waitLabel}</p>

            {waiting && status !== 'confirming' && status !== 'submitting' && (
                <div className="glass-panel p-4 space-y-3 bg-amber-50" data-testid="erasure-waiting">
                    <p className="text-sm font-bold text-stone-900 leading-relaxed">{waitingLabel}</p>
                    <button
                        type="button"
                        onClick={() => { void requests.cancel(waiting.id); }}
                        disabled={requests.cancellingId === waiting.id}
                        className="w-full py-3 px-4 rounded-xl bg-white text-red-700 font-bold ring-1 ring-red-300 disabled:opacity-60"
                        data-testid="erasure-waiting-cancel"
                    >
                        {tDataRights(locale, 'recent.cancelAction')}
                    </button>
                </div>
            )}

            {status === 'idle' && !waiting && (
                <div>
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

            <MyErasureRequests locale={locale} requests={requests} />
        </div>
    );
};

export default ErasureRequestScreen;
