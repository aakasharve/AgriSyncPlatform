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
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { joinByCodeCopy } from './joinByCodeCopy';
import { CardScanner, platformQrDetector } from '../../labour/identity/CardScanner';
import { InvitationCard } from '../../invitations/InvitationCard';
import { invitationCopy } from '../../invitations/invitationCopy';
import { normalizeInvitationCode } from '../../invitations/invitationModel';
import {
    findInvitation,
    invitationRefusal,
    type InvitationCard as InvitationCardData,
} from '../../invitations/personalInvitationClient';

// spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — round-2 review LANG-strict-EN-join) — the words
// live in `joinByCodeCopy.ts` with an English side, so someone who chose English sees English here too.
// `JOIN_BY_CODE_COPY` (the Marathi) is still exported from here for the screens that already import it.
export { JOIN_BY_CODE_COPY } from './joinByCodeCopy';

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

/** Fix round 1 (L-7): what the invitation scanner hands back for a FARM's QR, so it is answered, not ignored. */
const FARM_QR_SEEN = 'farm-qr';

/** The invitation scanner's reader: an invitation's eight digits, or the mark of a farm's QR link. */
const readScanned = (raw: string | null | undefined): string | null =>
    normalizeInvitationCode(raw) ?? (raw && readJoinLink(raw) ? FARM_QR_SEEN : null);

const defaultOpenJoinLink = (href: string): void => {
    if (typeof window !== 'undefined') window.location.assign(href);
};

const JoinByCodeScreen: React.FC<JoinByCodeScreenProps> = ({ isOpen, onClose, onJoined, openJoinLink = defaultOpenJoinLink }) => {
    const language = useOptionalLanguage()?.language;
    const C = joinByCodeCopy(language);
    const I = invitationCopy(language);
    // spec: plr-d10 lane MU-2 — a personal invitation found by its eight digits (typed, pasted as its link, or scanned).
    const [invitation, setInvitation] = useState<{ card: InvitationCardData; code: string } | null>(null);
    const [scanning, setScanning] = useState(false);
    const [farmQrSeen, setFarmQrSeen] = useState(false);
    const [digitsFarmCode, setDigitsFarmCode] = useState<string | null>(null);
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
        setInvitation(null);
        setScanning(false);
        setFarmQrSeen(false);
        setDigitsFarmCode(null);
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

    /** spec: plr-d10 lane MU-2 — the card for an invitation code (any wrong code gets the one "not found" line). */
    const findCard = async (code: string) => {
        if (inFlightRef.current) return;
        const run = runRef.current;
        inFlightRef.current = true;
        lastSentRef.current = null;
        setProblem(null);
        setPhase('sending');
        try {
            const card = await findInvitation(code);
            if (run !== runRef.current) return;
            setInvitation({ card, code });
            setPhase('enter');
        } catch (error) {
            if (run !== runRef.current) return;
            const why = invitationRefusal(error, 'invitee');
            setPhase('enter');
            setProblem(why === 'unknown' ? 'unknown' : why === 'rate_limited' ? 'rateLimited' : 'failed');
        } finally {
            if (run === runRef.current) inFlightRef.current = false;
        }
    };

    const handleChange = (value: string) => {
        setRaw(value);
        setProblem(null);
        setFarmQrSeen(false);
        setDigitsFarmCode(null);
        // An invitation's eight digits (or its shared link): its card, not a farm code.
        const invitationCode = normalizeInvitationCode(value);
        if (invitationCode) {
            void findCard(invitationCode);
            return;
        }
        if (looksLikeLink(value)) {
            const link = readJoinLink(value);
            if (link) openJoinLink(joinLandingHref(link));
            else setProblem('badLink');
            return;
        }
        const code = normalizeFarmCode(value);
        // Digits only: it may be an invitation still being typed (eight digits), so nothing goes by itself. A farm code
        // that happens to be six digits is sent with a tap.
        if (/^[0-9]+$/.test(code)) {
            if (code.length === FARM_CODE_LENGTH && isCompleteFarmCode(code)) setDigitsFarmCode(code);
            else if (code.length > 8) setProblem('unknown');
            return;
        }
        if (isCompleteFarmCode(code)) {
            if (code === lastUnknownRef.current) setProblem('unknown');
            else void send(code);
            return;
        }
        // As long as a code (or longer) and still not one: say so at once, without asking anyone.
        if (code.length >= FARM_CODE_LENGTH) setProblem('unknown');
    };

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
                <PageBar title={C.title} onBack={onClose} backLabel={C.back} />

                {invitation && phase !== 'done' && (
                    <div className="space-y-3" data-testid="join-invitation">
                        <InvitationCard card={invitation.card} code={invitation.code}
                            onAnswered={answer => {
                                if (answer) {
                                    onJoinedRef.current?.({
                                        farmId: answer.farmId,
                                        farmName: answer.farmName,
                                        status: answer.status === 'Active' ? 'Active' : 'PendingApproval',
                                    });
                                }
                            }} />
                        <BigButton tone="white" testId="join-invitation-close" onClick={onClose}>{C.ok}</BigButton>
                    </div>
                )}

                {!invitation && phase !== 'done' && (
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
                            {digitsFarmCode && phase === 'enter' && (
                                <div className="mt-2">
                                    <BigButton testId="join-code-send-digits" onClick={() => void send(digitsFarmCode)}>{I.send}</BigButton>
                                </div>
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
                            {/* spec: plr-d10 lane MU-2 — the in-app scanner (WID's, no new library) for an invitation QR. A
                                phone without the platform's QR reader shows one line: type the code above. */}
                            {platformQrDetector() ? (
                                scanning ? (
                                    <div className="mt-2">
                                        <CardScanner readCode={readScanned} showTyped={false} paused={phase === 'sending'}
                                            onCode={code => {
                                                setScanning(false);
                                                if (code === FARM_QR_SEEN) {
                                                    setFarmQrSeen(true);
                                                    return;
                                                }
                                                void findCard(code);
                                            }}
                                            onCancel={() => setScanning(false)} />
                                    </div>
                                ) : (
                                    <div className="mt-2 space-y-2">
                                        {farmQrSeen && (
                                            <p role="status" className="m-0 text-[14px] font-bold leading-snug text-amber-800" data-testid="join-farm-qr-line">
                                                {I.farmQrAtInvitationDoor}
                                            </p>
                                        )}
                                        <BigButton tone="white" testId="join-scan-qr" onClick={() => { setFarmQrSeen(false); setScanning(true); }}>{I.scanQr}</BigButton>
                                    </div>
                                )
                            ) : (
                                <p className="m-0 mt-2 text-[13px] font-bold text-stone-600" data-testid="join-no-scanner">{I.noScanner}</p>
                            )}
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
