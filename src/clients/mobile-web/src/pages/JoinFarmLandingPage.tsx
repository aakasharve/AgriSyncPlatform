/**
 * JoinFarmLandingPage — where a worker lands after scanning the farm QR.
 *
 * Design rules (semi-literate farmer friendly):
 *   - One task per screen. Phone, then OTP, then "you're in."
 *   - One input, giant font, autofocus.
 *   - One primary button per screen.
 *   - ONE language per screen (PLR-D9 T1/T2): the words are `joinLandingCopy` in the chosen
 *     language — Marathi unless English was chosen (स्वागत, सेट-अप केंद्र, or the consent notice's
 *     मराठी / English switch on this page). Never Marathi and English side by side, and never the
 *     server's English error to someone reading Marathi (round-2 review LANG-2-QR).
 *   - No jargon, no policy toggles, no back-buttons that can strand a user.
 *
 * Backend: calls /user/auth/start-otp and /user/auth/verify-otp on the
 * .NET API. In dev, the backend's DevStubSmsSender writes the OTP to the
 * console; in prod it dispatches via MSG91.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ArrowRight, Phone, MessageCircleMore, Leaf } from 'lucide-react';
import { parseJoinPayload } from '../features/onboarding/qr/qrTokenClient';
import { recordJoinAttempt } from '../features/onboarding/qr/farmInviteStore';
import { setAuthSession } from '../infrastructure/storage/AuthTokenStore';
import { setRememberDevice } from '../infrastructure/storage/RememberDeviceStore';
import { getOrCreateDeviceId } from '../infrastructure/storage/DeviceIdStore';
import { startOtp, verifyOtp, isOtpError } from '../features/auth/data/otpClient';
import { claimFarmJoin, getMyFarms, isInviteApiError, type ClaimResponse } from '../features/onboarding/qr/inviteApi';
import { agriSyncClient } from '../infrastructure/api/AgriSyncClient';
import { useOptionalAuth } from '../app/providers/AuthProvider';
import { useUiPref } from '../shared/hooks/useUiPref';
import { getOperatorRoleLabel } from '../shared/roles/roleLabels';
import { isActiveSeat } from '../core/session/seatStatus';
import { joinByCodeCopy } from '../features/onboarding/components/joinByCodeCopy';
import { joinLandingCopy, otpVerifyProblem, type JoinProblem } from '../features/onboarding/qr/joinLandingCopy';
import { waitingSeatKind } from '../features/onboarding/components/PendingJoinRequests';
import { useLanguage } from '../i18n/LanguageContext';
// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 (X1) — a QR deep link used to
// skip consent entirely: this page sent the number (startOtp) and verified it with no
// consent anywhere. The tick now sits on the phone step and is recorded before the send.
import ConsentTick from '../features/consent/gate/ConsentTick';
import { useConsentBeforeOtp } from '../features/consent/gate/useConsentBeforeOtp';

type Step = 'phone' | 'otp' | 'done' | 'invalid' | 'checking' | 'revoked';

/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — NO role here. A link's `role=` (or a QR
 * payload's `r=`) used to be shown as "you are joining as <role>", but the server never
 * honours it (ClaimJoinHandler decides the seat), so the page claimed something it could not
 * enforce (doctrine P5). The only role this page shows is the one the SERVER answered.
 */
interface JoinContext {
    token: string;
    farmCode: string;
}

/**
 * Joins this page has SERVER-CONFIRMED, by QR token. The (single-use) token
 * stays in the URL until the join is confirmed, so the page can be mounted
 * again - a re-mount mid-claim, or a browser refresh - and a fresh mount must
 * not start over at Step 1 with a token the server has consumed.
 *
 * Nothing here is a browser-only flag. An entry exists only because the server
 * said so: a successful claim (cross-checked against /farms/mine), or
 * /farms/mine itself listing the farm for a signed-in user who re-opens the
 * link. Module memory plus a live subscription: an instance mounted WHILE the
 * claim was in flight is told the moment the server answers. FIRST CONFIRMED
 * SUCCESS WINS: it is never replaced or undone by a later failure.
 *
 * The consumed token is stripped from the URL only after that confirmation, so
 * `lastConfirmedContext` keeps the page's context for a re-mount after the strip.
 */
const completedJoins = new Map<string, ClaimResponse>();
const joinListeners = new Set<(token: string, claim: ClaimResponse) => void>();
let lastConfirmedContext: JoinContext | null = null;
/**
 * The server REFUSED (or could not confirm) a join for a token. Kept in module
 * memory so a page mounted again - signed in this time - still tells him why,
 * instead of silently showing Step 1. Only ever set from a server answer.
 */
interface JoinFailure { code: string; problem: JoinProblem }
const joinFailures = new Map<string, JoinFailure>();
const REVOKED_CODES = ['join.token_invalid', 'join.farm_code_mismatch'];
export const __resetCompletedJoinsForTests = (): void => {
    completedJoins.clear();
    joinFailures.clear();
    lastConfirmedContext = null;
};

const readJoinContextFromUrl = (): JoinContext | null => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('join');
    const farmCode = params.get('farm');

    if (token && farmCode) {
        return { token, farmCode };
    }

    const qrPayload = params.get('q');
    if (qrPayload) {
        const parsed = parseJoinPayload(qrPayload);
        if (parsed.isValid && parsed.token && parsed.farmCode) {
            return { token: parsed.token, farmCode: parsed.farmCode };
        }
    }

    return null;
};

const clearJoinParamsFromUrl = () => {
    if (typeof window === 'undefined') return;
    try {
        const url = new URL(window.location.href);
        ['join', 'farm', 'role', 'q'].forEach(k => url.searchParams.delete(k));
        window.history.replaceState({}, '', url.toString());
    } catch {
        /* ignore */
    }
};

/**
 * Server truth: does /farms/mine list this farm AS ONE HE IS IN? `null` = the server could not be
 * asked. spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — /farms/mine also lists a typed-code
 * request still waiting for the owner; that is not membership, so only an Active seat counts.
 */
const askServerIfMember = async (match: { farmId?: string; farmCode?: string }): Promise<
    { name: string; role: string; farmId: string } | false | null
> => {
    try {
        const mine = (await getMyFarms()).filter(isActiveSeat);
        const hit = mine.find(f =>
            (match.farmId !== undefined && f.farmId === match.farmId)
            || (match.farmCode !== undefined && f.farmCode === match.farmCode));
        return hit ? { name: hit.name, role: hit.role, farmId: hit.farmId } : false;
    } catch {
        return null;
    }
};

/** Record a SERVER-CONFIRMED join, tell mounted instances, and only then strip the consumed token. */
const confirmJoin = (context: JoinContext, claim: ClaimResponse): void => {
    if (completedJoins.has(context.token)) return;
    completedJoins.set(context.token, claim);
    lastConfirmedContext = context;
    joinListeners.forEach(listener => listener(context.token, claim));
    clearJoinParamsFromUrl();
};

const normalizePhone = (value: string): string => value.replace(/\D+/g, '').slice(0, 10);

interface JoinFarmLandingPageProps {
    onComplete?: () => void;
    onExit?: () => void;
}

interface LastJoinedFarmRecord {
    farmCode: string;
    farmId: string;
    farmName: string;
    role: string;
    membershipId: string;
    joinedAtUtc: string;
    phone: string;
    userId: string;
}

const JoinFarmLandingPage: React.FC<JoinFarmLandingPageProps> = ({ onComplete, onExit }) => {
    const context = useMemo(() => readJoinContextFromUrl() ?? lastConfirmedContext, []);
    const auth = useOptionalAuth();
    const [joined, setJoined] = useState<ClaimResponse | null>(() => (context ? completedJoins.get(context.token) ?? null : null));
    const [step, setStep] = useState<Step>(() => {
        if (!context) return 'invalid';
        if (joined) return 'done';
        if (REVOKED_CODES.includes(joinFailures.get(context.token)?.code ?? '')) return 'revoked';
        // Boot auth is SKIPPED for join links, so the visitor may well be a signed-in
        // member the app has not recognised yet: resolve the session and ask the
        // server before showing Step 1 (see the effect below).
        return 'checking';
    });
    // One press = one claim. State alone cannot stop two taps in the same tick,
    // and the second claim for a consumed token answers "invalid" - which used
    // to throw a worker who HAD joined back to Step 1.
    const claimingRef = useRef(false);
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<JoinProblem | null>(() => (context ? joinFailures.get(context.token)?.problem ?? null : null));
    // spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2
    // Pre-checked by founder decision (2026-06-27).
    const [rememberDevice, setRememberDeviceState] = useState(true);
    const otpInputRef = useRef<HTMLInputElement | null>(null);
    const { t, language } = useLanguage();
    const copy = joinLandingCopy(language);
    const seatCopy = joinByCodeCopy(language);
    const consent = useConsentBeforeOtp(phone);
    // One press = one send: a second tap in the same tick must not send the number twice.
    const sendingRef = useRef(false);

    // Sub-plan 04 Task 3 — both prefs now live in Dexie's uiPrefs via
    // useUiPref. The "last joined farm" record was previously persisted as
    // a JSON-encoded string in localStorage; useUiPref stores the object
    // directly (no JSON.stringify boundary).
    const [, setPermissionsGranted] = useUiPref<boolean>('shramsafal_permissions_granted', false);
    const [, setLastJoinedFarm] = useUiPref<LastJoinedFarmRecord | null>('shramsafal_last_joined_farm_v1', null);

    // A confirmation that lands while this instance is on screen - including one
    // this very instance did not start because the page was re-mounted
    // mid-claim - moves it to the joined state. Nothing moves it back.
    useEffect(() => {
        if (!context) return undefined;
        const listener = (token: string, claim: ClaimResponse) => {
            if (token !== context.token) return;
            setJoined(claim);
            setStep('done');
            setError(null);
        };
        joinListeners.add(listener);
        return () => { joinListeners.delete(listener); };
    }, [context]);

    // Opened (or re-opened) with a token: the server, not the browser, says who
    // he is and whether he is already in. AuthProvider skips boot auth for join
    // links, so this page resolves the session itself with the existing refresh,
    // then reads /farms/mine: farm listed -> joined (no claim); anything else ->
    // Step 1, honestly. A rejected refresh means no session: straight to Step 1.
    const authenticated = auth?.isAuthenticated ?? false;
    const authChecking = auth?.authStatus === 'checking';
    useEffect(() => {
        if (!context || completedJoins.has(context.token)) return undefined;
        if (authChecking) return undefined;
        if (claimingRef.current) return undefined;
        let cancelled = false;
        const toStep1 = () => {
            const failure = joinFailures.get(context.token);
            setStep(prev => (prev === 'checking' ? (failure && REVOKED_CODES.includes(failure.code) ? 'revoked' : 'phone') : prev));
        };
        void (async () => {
            if (!authenticated) {
                let outcome: { kind: string } = { kind: 'unreachable' };
                try {
                    outcome = await agriSyncClient.refreshSession();
                } catch {
                    /* unreachable: the server below decides, not this page */
                }
                if (cancelled || completedJoins.has(context.token)) return;
                if (outcome.kind === 'rejected') { toStep1(); return; }
            }
            const hit = await askServerIfMember({ farmCode: context.farmCode });
            if (cancelled || completedJoins.has(context.token)) return;
            if (hit) {
                confirmJoin(context, {
                    membershipId: '', farmId: hit.farmId, farmName: hit.name, role: hit.role, wasAlreadyMember: true,
                });
            } else {
                toStep1();
            }
        })();
        return () => { cancelled = true; };
    }, [context, authenticated, authChecking]);

    useEffect(() => {
        if (step === 'otp') {
            otpInputRef.current?.focus();
        }
    }, [step]);

    if (!context || step === 'revoked') {
        return (
            <div className="min-h-screen bg-stone-50 px-4 py-10">
                <div className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm">
                    <h1 className="font-display text-xl font-black text-stone-900">
                        {copy.invalidTitle}
                    </h1>
                    <p className="mt-2 text-sm text-stone-500">
                        {copy.invalidLine}
                    </p>
                    {onExit && (
                        <button
                            type="button"
                            onClick={onExit}
                            className="mt-5 w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-bold text-white"
                        >
                            {copy.back}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    const handlePhoneSubmit = async () => {
        setError(null);
        if (phone.length !== 10) {
            setError({ key: 'phoneLength' });
            return;
        }
        if (!consent.canSend || sendingRef.current) return;
        sendingRef.current = true;
        setIsSubmitting(true);
        // Consent FIRST. If the two records cannot be written the number is not sent.
        try {
            await consent.recordIfNeeded();
        } catch {
            setError({ key: 'consentSave' });
            setIsSubmitting(false);
            sendingRef.current = false;
            return;
        }
        try {
            await startOtp(phone);
            setStep('otp');
        } catch (err) {
            if (isOtpError(err)) {
                // The same split as the login screen (OtpLoginForm): "too many" is said in the screen's
                // language; any other refusal keeps the server's own (English) words for English only.
                setError(err.status === 429 ? { key: 'sendTooMany' } : { key: 'sendFailed', server: err.message });
            } else {
                setError({ key: 'unreachable' });
            }
        } finally {
            setIsSubmitting(false);
            sendingRef.current = false;
        }
    };

    const handleOtpSubmit = async () => {
        if (claimingRef.current || joined) return;
        setError(null);
        if (otp.length !== 6) {
            setError({ key: 'otpLength' });
            return;
        }
        claimingRef.current = true;
        joinFailures.delete(context.token);
        setIsSubmitting(true);

        try {
            // Step 1: verify the OTP. This creates/fetches the User and
            // returns an identity-only JWT with phone_verified=true.
            const deviceId = getOrCreateDeviceId();
            const result = await verifyOtp(phone, otp, undefined, {
                rememberDevice,
                deviceId,
                platform: 'web',
            });

            // spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2
            // Persist the flag so AgriSyncClient.refreshSession() picks it up.
            setRememberDevice(rememberDevice);
            setAuthSession({
                userId: result.userId,
                accessToken: result.accessToken,
                expiresAtUtc: result.expiresAtUtc,
            });

            setPermissionsGranted(true);

            // Step 2: redeem the QR token to create the FarmMembership.
            // The auth session from step 1 is already stored so this
            // fetch carries the Authorization: Bearer header.
            const claim = await claimFarmJoin(context.token, context.farmCode);

            setLastJoinedFarm({
                farmCode: context.farmCode,
                farmId: claim.farmId,
                farmName: claim.farmName,
                role: claim.role,
                membershipId: claim.membershipId,
                joinedAtUtc: new Date().toISOString(),
                phone,
                userId: result.userId,
            });
            recordJoinAttempt(context.farmCode, context.token, 'verified');

            // The claim answered 200 (server truth). Cross-check it against the
            // server's own membership list: if that list ANSWERS and omits the
            // farm, this is not a join - fall to the failure/retry path below.
            // spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F3) — unless the claim itself
            // says the seat is NOT Active (an earlier typed-code request still waiting for
            // the owner): that is an honest answer, shown as "waiting", not as a failure
            // and never as "joined".
            const listed = isActiveSeat(claim) ? await askServerIfMember({ farmId: claim.farmId }) : null;
            if (listed === false) {
                throw { error: 'join.not_confirmed', message: '', status: 0 };
            }
            confirmJoin(context, claim);
            setJoined(claim);
            setStep('done');
        } catch (err) {
            // A join already confirmed for this token outranks any later failure
            // (a second claim answering "invalid" for the token the first one
            // consumed must never throw the farmer back to Step 1).
            if (completedJoins.has(context.token)) return;
            // isOtpError and isInviteApiError are the same shape check, so the claim's own
            // `join.*` codes must be told apart by prefix first, or they land in the OTP branch.
            if (isOtpError(err) && !String(err.error).startsWith('join.')) {
                setError(otpVerifyProblem(err));
                if (err.error === 'otp.expired' || err.error === 'otp.locked_out' || err.error === 'otp.no_pending_challenge') {
                    setStep('phone');
                    setOtp('');
                }
            } else if (isInviteApiError(err)) {
                // OTP succeeded but the QR is invalid / revoked — keep the
                // user authenticated but surface the specific claim error.
                // `join.not_confirmed` is this page's own: the claim answered but /farms/mine
                // did not list the farm — said as "could not reach", never in the server's words.
                const problem: JoinProblem = err.error === 'join.not_confirmed'
                    ? { key: 'unreachable' }
                    : { key: 'claimFailed', server: err.message };
                setError(problem);
                joinFailures.set(context.token, { code: err.error, problem });
                if (REVOKED_CODES.includes(err.error)) {
                    // The QR itself is dead (rotated / revoked / wrong farm): a phone
                    // number cannot fix that. Say so, and say who can.
                    setStep('revoked');
                }
            } else {
                setError({ key: 'unreachable' });
            }
            recordJoinAttempt(context.farmCode, context.token, 'failed');
        } finally {
            claimingRef.current = false;
            setIsSubmitting(false);
        }
    };

    // Said in the screen's language when drawn, so the consent notice's language switch changes it too.
    const errorText = error === null ? null
        : error.key === 'consentSave' ? t('consentGate.saveFailed')
            : (language === 'en' && error.server ? error.server : copy.errors[error.key]);

    const handleFinish = () => {
        clearJoinParamsFromUrl();
        onComplete?.();
        if (typeof window !== 'undefined' && !onComplete) {
            window.location.assign('/');
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-stone-50 to-stone-50 px-4 py-8">
            <div className="mx-auto max-w-md">
                <header className="mb-6 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-emerald-600 text-white shadow-md">
                        <Leaf size={24} />
                    </div>
                    <h1 className="mt-3 font-display text-3xl font-black text-stone-900">
                        {copy.brand}
                    </h1>
                    {step !== 'done' && (
                        /* PROPOSED Marathi. Neither the farm's name (the link carries only a
                           placeholder) nor a role (the server decides it) is known here yet. */
                        <p data-testid="join-intro" className="text-sm font-semibold text-stone-500">
                            {copy.intro}
                        </p>
                    )}
                </header>

                <StepIndicator step={step} />

                {step === 'checking' && (
                    <p data-testid="join-checking" className="text-center text-sm font-semibold text-stone-500">
                        {copy.checking}
                    </p>
                )}

                {step === 'phone' && (
                    <section className="rounded-3xl bg-white p-6 shadow-lg shadow-emerald-100/50">
                        <label htmlFor="join-phone" className="block text-center">
                            <div className="flex items-center justify-center gap-2 text-emerald-700">
                                <Phone size={14} />
                                <span className="text-[11px] font-bold uppercase tracking-widest">
                                    {copy.step1}
                                </span>
                            </div>
                            <div className="mt-2 font-display text-xl font-black text-stone-900">
                                {copy.phoneTitle}
                            </div>
                            <div className="text-sm font-semibold text-stone-500">
                                {copy.phoneLine}
                            </div>
                        </label>

                        <div className="mt-5 flex items-stretch rounded-2xl border-2 border-stone-200 bg-stone-50 focus-within:border-emerald-400 focus-within:bg-white">
                            <div className="flex items-center px-3 text-base font-bold text-stone-500">
                                +91
                            </div>
                            <input
                                id="join-phone"
                                type="tel"
                                inputMode="numeric"
                                autoComplete="tel"
                                autoFocus
                                value={phone}
                                onChange={e => {
                                    setError(null);
                                    setPhone(normalizePhone(e.target.value));
                                }}
                                placeholder="9876543210"
                                className="w-full bg-transparent py-3 pr-4 text-center font-mono text-2xl font-black tracking-[0.25em] text-stone-900 outline-none placeholder:text-stone-300"
                            />
                        </div>

                        <div className="mt-4">
                            <ConsentTick consent={consent} disabled={isSubmitting} />
                        </div>

                        {errorText && (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs font-semibold text-rose-700">
                                {errorText}
                            </div>
                        )}

                        <button
                            type="button"
                            disabled={phone.length !== 10 || isSubmitting || !consent.canSend}
                            onClick={handlePhoneSubmit}
                            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSubmitting ? copy.sending : copy.send}
                            {!isSubmitting && <ArrowRight size={18} />}
                        </button>
                    </section>
                )}

                {step === 'otp' && (
                    <section className="rounded-3xl bg-white p-6 shadow-lg shadow-emerald-100/50">
                        <div className="flex items-center justify-center gap-2 text-emerald-700">
                            <MessageCircleMore size={14} />
                            <span className="text-[11px] font-bold uppercase tracking-widest">
                                {copy.step2}
                            </span>
                        </div>
                        <div className="mt-2 text-center">
                            <div className="font-display text-xl font-black text-stone-900">
                                {copy.otpTitle}
                            </div>
                            <div className="text-sm font-semibold text-stone-500" data-testid="join-otp-sent-to">
                                {copy.sentTo(phone)}
                            </div>
                        </div>

                        <input
                            ref={otpInputRef}
                            type="tel"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={otp}
                            onChange={e => {
                                setError(null);
                                setOtp(e.target.value.replace(/\D+/g, '').slice(0, 6));
                            }}
                            placeholder="••••••"
                            className="mt-5 w-full rounded-2xl border-2 border-stone-200 bg-stone-50 py-4 text-center font-mono text-3xl font-black tracking-[0.8em] text-stone-900 outline-none placeholder:text-stone-300 focus:border-emerald-400 focus:bg-white"
                        />

                        {errorText && (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs font-semibold text-rose-700">
                                {errorText}
                            </div>
                        )}

                        {/* spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2
                            Remember this device — pre-checked (founder decision 2026-06-27). */}
                        <div className="mt-4 flex items-center gap-2">
                            <input
                                id="remember-device-join"
                                type="checkbox"
                                checked={rememberDevice}
                                onChange={(e) => setRememberDeviceState(e.target.checked)}
                                disabled={isSubmitting}
                                className="h-4 w-4 rounded border-stone-300 accent-emerald-600"
                            />
                            <label
                                htmlFor="remember-device-join"
                                className="text-xs font-medium text-stone-600 select-none cursor-pointer"
                            >
                                <span style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>
                                    {copy.remember}
                                </span>
                            </label>
                        </div>

                        <button
                            type="button"
                            disabled={otp.length !== 6 || isSubmitting}
                            onClick={handleOtpSubmit}
                            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSubmitting ? copy.joining : copy.join}
                            {!isSubmitting && <ArrowRight size={18} />}
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                setStep('phone');
                                setOtp('');
                                setError(null);
                            }}
                            className="mt-3 w-full text-center text-xs font-semibold text-stone-500 hover:text-stone-700"
                        >
                            {copy.changePhone}
                        </button>
                    </section>
                )}

                {/* spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F3) — the QR claim returned an
                    EXISTING seat that is not Active. Not "joined": no role, no "open my farm".
                    The server now lets a typed-code request in through the owner's QR, so what
                    reaches here is a PAUSED seat (said as paused — never as a request, m2) or a
                    request from another path still waiting for the owner. PROPOSED Marathi. */}
                {step === 'done' && joined && !isActiveSeat(joined) && (
                    <section data-testid="join-done-waiting" data-kind={waitingSeatKind(joined.status)} className="rounded-3xl bg-white p-6 text-center shadow-lg shadow-amber-100/50">
                        <h2 className="mt-2 font-display text-2xl font-black text-stone-900">
                            {waitingSeatKind(joined.status) === 'paused'
                                ? seatCopy.pausedTitle
                                : copy.waitingTitle}
                        </h2>
                        {joined.farmName && (
                            <p data-testid="join-done-farm" className="mt-2 text-lg font-bold text-stone-800">
                                {joined.farmName}
                            </p>
                        )}
                        <p className="mt-2 text-sm font-semibold text-stone-600">
                            {waitingSeatKind(joined.status) === 'paused'
                                ? seatCopy.pausedLine
                                : copy.waitingLine}
                        </p>
                        <button
                            type="button"
                            onClick={handleFinish}
                            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-900 px-4 py-3 text-base font-bold text-white"
                        >
                            {copy.ok}
                        </button>
                    </section>
                )}

                {step === 'done' && (!joined || isActiveSeat(joined)) && (
                    <section className="rounded-3xl bg-white p-6 text-center shadow-lg shadow-emerald-100/50">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                            <CheckCircle2 size={32} className="text-emerald-600" />
                        </div>
                        <h2 className="mt-4 font-display text-2xl font-black text-stone-900">
                            {copy.doneTitle}
                        </h2>
                        {/* The farm the SERVER says he joined (claim.farmName), and the role
                            it gave him - never a placeholder (the QR link carries no farm
                            name), and never the role the link merely PROPOSED. */}
                        {joined?.farmName && (
                            <p data-testid="join-done-farm" className="mt-2 text-lg font-bold text-stone-800">
                                {joined.farmName}
                            </p>
                        )}
                        {joined?.role && (
                            <p data-testid="join-done-role" className="text-sm font-semibold text-stone-600">
                                {language === 'en' ? getOperatorRoleLabel(joined.role).en : getOperatorRoleLabel(joined.role).mr}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={handleFinish}
                            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-base font-bold text-white hover:bg-emerald-700"
                        >
                            {copy.openFarm}
                            <ArrowRight size={16} />
                        </button>
                    </section>
                )}
            </div>
        </div>
    );
};

const StepIndicator: React.FC<{ step: Step }> = ({ step }) => {
    if (step === 'invalid') return null;
    const stepIndex = step === 'phone' || step === 'checking' ? 0 : step === 'otp' ? 1 : 2;
    return (
        <div className="mb-4 flex items-center justify-center gap-2">
            {[0, 1, 2].map(index => {
                const active = index <= stepIndex;
                return (
                    <div
                        key={index}
                        className={`h-1.5 w-8 rounded-full transition-colors ${
                            active ? 'bg-emerald-500' : 'bg-stone-200'
                        }`}
                    />
                );
            })}
        </div>
    );
};

export default JoinFarmLandingPage;
