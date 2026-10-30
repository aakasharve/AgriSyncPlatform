// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-13, D-36)
//
// The ONE-TIME question to a farmer who is already signed in when the notice changes
// materially (founder D-36: "Publish the revised notice and ask once for acceptance of this
// material change, alongside the separate optional choice").
//
//   • the changed promise, in his language, word for word from the notice;
//   • the optional improvement switch — starting at what the server holds when that can be
//     read in time, otherwise OFF; saved as its own record;
//   • the same tick as the login screen (the same hashed words, the same link to the full
//     notice);
//   • one button, live only once he has ticked.
//
// Required, like the login tick: the app opens once he has ticked. It is asked once — after
// that the phone holds the acceptance (and the server, once it is sent), so it never shows
// again for this notice, on this phone or another.
//
// NEVER HELD BY THE NETWORK (P10). The acceptance is written to the phone's queue and the
// sheet closes at once; the send runs in the background. Only when the phone cannot hold it is
// one direct send tried (bounded). If both fail nothing is marked, he is told, and the button
// is live again. Every network wait here is bounded.

import React, { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import ConsentTick from '../gate/ConsentTick';
import { CONSENT_NOTICE, type NoticeLanguage } from '../gate/consentNotice';
import type { ConsentBeforeOtp } from '../gate/useConsentBeforeOtp';
import ImprovementPermissionToggle from '../improvement/ImprovementPermissionToggle';
import { IMPROVEMENT_WORDING_VERSION } from '../improvement/improvementPermissionCopy';
import { flushNoticeReacceptance, needsNoticeReacceptance, recordNoticeReacceptance } from './noticeReacceptance';
import { withTimeout } from './withTimeout';

/** How long the sheet waits to learn what the server holds for the improvement switch. */
const IMPROVEMENT_READ_LIMIT_MS = 3_000;
/** How long it waits for a CHANGED improvement choice to reach the server. */
const IMPROVEMENT_SEND_LIMIT_MS = 15_000;

const COPY: Record<NoticeLanguage, {
    heading: string; intro: string; tickToContinue: string; continue: string; ok: string; acceptFailed: string;
}> = {
    mr: {
        heading: 'माहिती वापराच्या सूचनेत बदल', // PROPOSED (Marathi)
        intro: 'तुमच्या आवाजाबद्दलचं आमचं वचन बदललं आहे. आता ते असं आहे:', // PROPOSED (Marathi)
        tickToContinue: 'पुढे जाण्यासाठी खूण करा.', // PROPOSED (Marathi)
        continue: 'पुढे', // PROPOSED (Marathi)
        ok: 'ठीक आहे', // PROPOSED (Marathi)
        acceptFailed: 'तुमची खूण आत्ता जतन झाली नाही. पुन्हा "पुढे" दाबा.', // PROPOSED (Marathi)
    },
    en: {
        heading: 'The data notice has changed', // PROPOSED (English)
        intro: 'Our promise about your voice has changed. It now reads:', // PROPOSED (English)
        tickToContinue: 'Tick the box to continue.', // PROPOSED (English)
        continue: 'Continue', // PROPOSED (English)
        ok: 'OK', // PROPOSED (English)
        acceptFailed: 'Your tick was not saved just now. Press "Continue" again.', // PROPOSED (English)
    },
};

type Phase = 'checking' | 'ask' | 'saving' | 'improvement-not-saved' | 'done';

const toNoticeLanguage = (lang: string): NoticeLanguage => (lang === 'en' ? 'en' : 'mr');

const NoticeChangeSheet: React.FC<{ userId: string }> = ({ userId }) => {
    const { language } = useLanguage();
    const lang = toNoticeLanguage(language);
    const [phase, setPhase] = useState<Phase>('checking');
    const [ticked, setTicked] = useState(false);
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [acceptFailed, setAcceptFailed] = useState(false);
    // What the server holds for the improvement switch: true / false when read in time; null when
    // it could not be read (unknown). `improvementRead` is false until that read has settled.
    const [serverImprovement, setServerImprovement] = useState<boolean | null>(null);
    const [improvementRead, setImprovementRead] = useState(false);
    const [improvement, setImprovement] = useState(false);

    // On open (and whenever the phone comes back online): send any acceptance still queued, then
    // decide whether he must be asked, and learn what the server holds for the improvement switch.
    useEffect(() => {
        let cancelled = false;
        void flushNoticeReacceptance();
        void needsNoticeReacceptance(async () => (await agriSyncClient.getConsent()).acceptedNoticeVersion)
            .then((needed) => { if (!cancelled) setPhase(needed ? 'ask' : 'done'); })
            .catch(() => { if (!cancelled) setPhase('ask'); });
        void withTimeout(agriSyncClient.getImprovementPermission(), IMPROVEMENT_READ_LIMIT_MS)
            .then((dto) => {
                if (cancelled) return;
                // ON only when he agreed to THESE words — the same rule as the privacy page.
                const held = dto.allowed && dto.wordingVersion === IMPROVEMENT_WORDING_VERSION;
                setServerImprovement(held);
                setImprovement(held);
            })
            .catch(() => { /* unknown: start OFF */ })
            .finally(() => { if (!cancelled) setImprovementRead(true); });
        const onOnline = () => { void flushNoticeReacceptance(); };
        if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
        return () => {
            cancelled = true;
            if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
        };
    }, [userId]);

    // ConsentTick reads this shape; only the parts it uses are meaningful here.
    const tick: ConsentBeforeOtp = useMemo(() => ({
        status: 'required',
        ticked,
        setTicked,
        recording: phase === 'saving',
        canSend: ticked,
        language: lang,
        noticeOpen,
        setNoticeOpen,
        recordIfNeeded: () => Promise.resolve(),
    }), [ticked, phase, lang, noticeOpen]);

    if (phase === 'checking' || phase === 'done') return null;

    const c = COPY[lang];
    const changedPromise = CONSENT_NOTICE[lang].willNotDo.items[2];

    const sendImprovement = (allowed: boolean) => agriSyncClient.setImprovementPermission({
        allowed,
        wordingVersion: IMPROVEMENT_WORDING_VERSION,
        languageShown: lang,
    });

    const accept = async () => {
        if (!ticked || phase === 'saving') return;
        setPhase('saving');
        setAcceptFailed(false);

        const outcome = await recordNoticeReacceptance(lang);
        if (outcome === 'failed') {
            // Nothing was marked on the phone and nothing reached the server: say so, let him retry.
            setAcceptFailed(true);
            setPhase('ask');
            return;
        }

        if (serverImprovement === null && !improvement) {
            // Unknown, and he left it OFF: bring the server to what he saw — ONE immediate attempt,
            // never queued, so it can never land later over a newer choice.
            void sendImprovement(false).catch(() => undefined);
            setPhase('done');
            return;
        }
        if (serverImprovement !== null && improvement === serverImprovement) {
            setPhase('done'); // unchanged: nothing to send
            return;
        }
        try {
            await withTimeout(sendImprovement(improvement), IMPROVEMENT_SEND_LIMIT_MS);
            setPhase('done');
        } catch {
            // The notice is accepted; only the optional choice did not reach the server. Say so.
            setPhase('improvement-not-saved');
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notice-change-heading"
            data-testid="notice-change-sheet"
            className="fixed inset-0 z-[60] overflow-y-auto bg-gradient-to-b from-emerald-50 via-white to-emerald-50 px-4 pb-10 pt-safe-area"
        >
            <div className="mx-auto max-w-md space-y-4 pt-6">
                <h1 id="notice-change-heading" className="text-xl font-bold text-stone-900">{c.heading}</h1>
                <p className="text-sm text-stone-700">{c.intro}</p>
                <p
                    data-testid="notice-change-promise"
                    className="rounded-xl bg-white px-4 py-3 text-[15px] font-semibold leading-snug text-stone-900 ring-1 ring-emerald-200"
                >
                    {changedPromise}
                </p>

                <ImprovementPermissionToggle
                    language={lang}
                    // Once we know it did not reach the server, show what the server holds.
                    checked={phase === 'improvement-not-saved' ? (serverImprovement ?? false) : improvement}
                    disabled={phase !== 'ask' || !improvementRead}
                    onChange={setImprovement}
                    saveFailed={phase === 'improvement-not-saved'}
                />

                {phase === 'improvement-not-saved' ? (
                    <button
                        type="button"
                        data-testid="notice-change-ok"
                        onClick={() => setPhase('done')}
                        className="w-full rounded-xl bg-emerald-700 py-3 text-base font-bold text-white"
                    >
                        {c.ok}
                    </button>
                ) : (
                    <>
                        <ConsentTick consent={tick} disabled={phase === 'saving'} showHint={false} />
                        {!ticked && (
                            <p className="px-1 text-[12.5px] font-medium text-stone-500" data-testid="notice-change-hint">
                                {c.tickToContinue}
                            </p>
                        )}
                        {acceptFailed && (
                            <p className="px-1 text-sm font-medium text-red-600" data-testid="notice-change-accept-failed">
                                {c.acceptFailed}
                            </p>
                        )}
                        <button
                            type="button"
                            data-testid="notice-change-continue"
                            disabled={!ticked || phase === 'saving'}
                            onClick={() => { void accept(); }}
                            className="w-full rounded-xl bg-emerald-700 py-3 text-base font-bold text-white disabled:bg-stone-300 disabled:text-stone-500"
                        >
                            {c.continue}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default NoticeChangeSheet;
