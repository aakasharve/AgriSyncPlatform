/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the door into someone else's farm, for a person
 * who is already signed in. Two ways in, one screen:
 *   - the farm CODE the owner reads out (the big box). A code that looks complete goes to the server
 *     BY ITSELF — no "next" button (approved preview MuEntry, plr-d1a `MuScreens.tsx:28-61`);
 *   - the owner's QR: scanned with the phone camera it opens the QR landing page; a QR LINK the
 *     owner sent can be pasted into the same box and goes to that same page.
 * Nobody picks their own role here (plan §2 #5): the server makes a PendingApproval seat and the
 * owner chooses the role when approving (step 2). A wrong code gets ONE plain line and never a farm
 * name; too many tries gets "थोड्या वेळाने पुन्हा प्रयत्न करा".
 *
 * Every Marathi string here is PROPOSED. The look is the shared place kit (`placeUi.tsx`); words
 * are taken from the approved preview where it had them. No sample data.
 */
import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, KeyRound, PauseCircle, QrCode } from 'lucide-react';
import { BigButton, GlassCard, PageBar, SANS } from '../../../shared/components/ui/placeUi';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { joinByCode, type JoinedFarm } from '../qr/inviteApi';
import {
    FARM_CODE_LENGTH,
    isCompleteFarmCode,
    joinLandingHref,
    looksLikeLink,
    normalizeFarmCode,
    readJoinLink,
} from '../qr/farmCodeEntry';

/** PROPOSED Marathi (founder review). `unknown` and `roleNote` follow the approved preview's words. */
export const JOIN_BY_CODE_COPY = {
    title: 'शेतात सामील व्हा',
    codeLabel: 'मालकाने दिलेला शेताचा कोड टाका',
    codePlaceholder: '६ अक्षरांचा कोड',
    roleNote: 'तुमची भूमिका मालक ठरवतील.',
    checking: 'तपासत आहे…',
    unknown: 'हा कोड सापडला नाही. मालकाला पुन्हा विचारा.',
    rateLimited: 'थोड्या वेळाने पुन्हा प्रयत्न करा',
    failed: 'आत्ता पाठवता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.',
    // M5: the sign-in itself is gone (refused even after one refresh) — the internet is not the problem.
    signedOut: 'तुमचं लॉगिन संपलं आहे. पुन्हा लॉग इन करा.',
    badLink: 'ही लिंक ओळखता आली नाही. मालकाला ती पुन्हा पाठवायला सांगा.',
    retry: 'पुन्हा पाठवा',
    qrTitle: 'QR असेल तर',
    qrLine: 'फोनच्या कॅमेऱ्याने QR स्कॅन करा — सामील होण्याचं पान उघडेल. मालकाने लिंक पाठवली असेल तर ती वरच्या चौकटीत टाका.',
    sentTitle: 'विनंती पाठवली',
    sentLine: 'मालक तुमची भूमिका ठरवतील आणि मंजूर करतील — तोपर्यंत वाट पाहा',
    activeTitle: 'तुम्ही आधीच या शेतात आहात',
    pausedTitle: 'या शेतातलं तुमचं काम थांबवलं आहे',
    pausedLine: 'मालकाशी बोला.',
    ok: 'ठीक आहे',
} as const;

type Phase = 'enter' | 'sending' | 'done';
type Problem = 'unknown' | 'rateLimited' | 'failed' | 'signedOut' | 'badLink' | null;

export interface JoinByCodeScreenProps {
    isOpen: boolean;
    onClose: () => void;
    /** The server said a seat exists (made now, or the caller's own earlier one). The caller refreshes its farm list. */
    onJoined?: (farm: JoinedFarm) => void;
    /** Where a pasted QR link goes. Default: open the app's QR landing page (a full page load, like a scanned QR). */
    openJoinLink?: (href: string) => void;
}

const defaultOpenJoinLink = (href: string): void => {
    if (typeof window !== 'undefined') window.location.assign(href);
};

const JoinByCodeScreen: React.FC<JoinByCodeScreenProps> = ({ isOpen, onClose, onJoined, openJoinLink = defaultOpenJoinLink }) => {
    const [raw, setRaw] = useState('');
    const [phase, setPhase] = useState<Phase>('enter');
    const [problem, setProblem] = useState<Problem>(null);
    const [joined, setJoined] = useState<JoinedFarm | null>(null);
    // One code = one request. `run` changes every time the screen opens, so an answer that arrives
    // after it was closed (or closed and opened again) never paints over the new screen.
    const runRef = useRef(0);
    const inFlightRef = useRef(false);
    const lastSentRef = useRef<string | null>(null);
    // The code the server just called unknown: typing it again says so without asking again
    // (every ask counts toward the rate limit).
    const lastUnknownRef = useRef<string | null>(null);
    const onJoinedRef = useRef(onJoined);
    onJoinedRef.current = onJoined;

    useEffect(() => {
        if (!isOpen) return;
        runRef.current += 1;
        inFlightRef.current = false;
        lastSentRef.current = null;
        lastUnknownRef.current = null;
        setRaw('');
        setPhase('enter');
        setProblem(null);
        setJoined(null);
    }, [isOpen]);

    useBackDismiss(isOpen, onClose);

    if (!isOpen) return null;

    const send = async (code: string) => {
        if (inFlightRef.current) return;
        const run = runRef.current;
        inFlightRef.current = true;
        lastSentRef.current = code;
        setProblem(null);
        setPhase('sending');
        const outcome = await joinByCode(code);
        // A seat the server made still refreshes the farm list, even if this screen has moved on.
        if (outcome.kind === 'joined') onJoinedRef.current?.(outcome.farm);
        if (run !== runRef.current) return;
        inFlightRef.current = false;
        if (outcome.kind === 'joined') {
            setJoined(outcome.farm);
            setPhase('done');
            return;
        }
        setPhase('enter');
        if (outcome.kind === 'code_unknown') {
            lastUnknownRef.current = code;
            setProblem('unknown');
        } else if (outcome.kind === 'signed_out') {
            // No retry: asking again with a sign-in the server refused cannot help.
            setProblem('signedOut');
        } else {
            setProblem(outcome.kind === 'rate_limited' ? 'rateLimited' : 'failed');
        }
    };

    const handleChange = (value: string) => {
        setRaw(value);
        setProblem(null);
        if (looksLikeLink(value)) {
            const link = readJoinLink(value);
            if (link) openJoinLink(joinLandingHref(link));
            else setProblem('badLink');
            return;
        }
        const code = normalizeFarmCode(value);
        if (isCompleteFarmCode(code)) {
            if (code === lastUnknownRef.current) setProblem('unknown');
            else void send(code);
            return;
        }
        // As long as a code (or longer) and still not one: say so at once, without asking anyone.
        if (code.length >= FARM_CODE_LENGTH) setProblem('unknown');
    };

    const C = JOIN_BY_CODE_COPY;
    const problemLine = problem === null ? null : {
        unknown: C.unknown,
        rateLimited: C.rateLimited,
        failed: C.failed,
        signedOut: C.signedOut,
        badLink: C.badLink,
    }[problem];
    const canRetry = (problem === 'rateLimited' || problem === 'failed') && lastSentRef.current !== null;

    return (
        /* z-[70]: above MinimalOnboarding / FirstFarmWizard (z-[60]) — the 0-farm screen opens this door. */
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-gradient-to-b from-emerald-50 via-stone-50 to-white"
            role="dialog" aria-modal="true" aria-label={C.title} data-testid="join-by-code" style={{ fontFamily: SANS }}>
            <div className="mx-auto max-w-md px-4 pb-10">
                <PageBar title={C.title} onBack={onClose} />

                {phase !== 'done' && (
                    <div className="space-y-3">
                        <GlassCard>
                            <label htmlFor="join-code-input" className="flex items-center gap-2 text-[16px] font-extrabold text-stone-900">
                                <KeyRound size={20} className="shrink-0 text-emerald-700" aria-hidden="true" />{C.codeLabel}
                            </label>
                            <input
                                id="join-code-input"
                                data-testid="join-code-input"
                                value={raw}
                                onChange={e => handleChange(e.target.value)}
                                disabled={phase === 'sending'}
                                placeholder={C.codePlaceholder}
                                autoFocus
                                autoCapitalize="characters"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                className="mt-2 min-h-[64px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-center font-mono text-[28px] font-extrabold uppercase tracking-[0.3em] text-stone-900 outline-none placeholder:font-sans placeholder:text-[16px] placeholder:normal-case placeholder:tracking-normal placeholder:text-stone-400 focus:border-emerald-600 disabled:opacity-60"
                            />
                            {phase === 'sending' && (
                                <p role="status" data-testid="join-code-checking" className="m-0 mt-2 flex items-center justify-center gap-2 text-[15px] font-extrabold text-stone-700">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-emerald-600" aria-hidden="true" />{C.checking}
                                </p>
                            )}
                            {problemLine && (
                                <p role="alert" data-testid="join-code-problem" className="m-0 mt-2 text-[15px] font-extrabold leading-snug text-rose-700">{problemLine}</p>
                            )}
                            {canRetry && (
                                <div className="mt-2">
                                    <BigButton tone="white" testId="join-code-retry" onClick={() => { if (lastSentRef.current) void send(lastSentRef.current); }}>{C.retry}</BigButton>
                                </div>
                            )}
                            <p className="m-0 mt-2 text-[13.5px] font-bold leading-snug text-stone-600" data-testid="join-code-role-note">{C.roleNote}</p>
                        </GlassCard>

                        <GlassCard testId="join-qr-door">
                            <p className="m-0 flex items-center gap-2 text-[16px] font-extrabold text-stone-900">
                                <QrCode size={20} className="shrink-0 text-blue-700" aria-hidden="true" />{C.qrTitle}
                            </p>
                            <p className="m-0 mt-1 text-[14px] font-semibold leading-snug text-stone-700">{C.qrLine}</p>
                        </GlassCard>
                    </div>
                )}

                {phase === 'done' && joined && (
                    <GlassCard testId="join-done" className="text-center">
                        <span className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${
                            joined.status === 'Active' ? 'bg-emerald-100 text-emerald-700'
                                : joined.status === 'Suspended' ? 'bg-stone-200 text-stone-700' : 'bg-amber-100 text-amber-700'}`}>
                            {joined.status === 'Active' ? <CheckCircle2 size={34} aria-hidden="true" />
                                : joined.status === 'Suspended' ? <PauseCircle size={34} aria-hidden="true" /> : <Clock3 size={34} aria-hidden="true" />}
                        </span>
                        <h2 className="m-0 mt-3 text-[22px] font-extrabold text-stone-900" data-testid="join-done-title">
                            {joined.status === 'Active' ? C.activeTitle : joined.status === 'Suspended' ? C.pausedTitle : C.sentTitle}
                        </h2>
                        {joined.farmName && (
                            <p className="m-0 mt-1 text-[19px] font-extrabold text-emerald-800 [overflow-wrap:anywhere]" data-testid="join-done-farm">{joined.farmName}</p>
                        )}
                        {joined.status !== 'Active' && (
                            <p className="m-0 mt-2 text-[16px] font-bold leading-snug text-stone-700" data-testid="join-done-line">
                                {joined.status === 'Suspended' ? C.pausedLine : C.sentLine}
                            </p>
                        )}
                        <div className="mt-4">
                            <BigButton testId="join-done-ok" onClick={onClose}>{C.ok}</BigButton>
                        </div>
                    </GlassCard>
                )}
            </div>
        </div>
    );
};

export default JoinByCodeScreen;
