/**
 * MinimalOnboarding — the screen a signed-in person with 0 farms sees.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-3 / MU-1, FR-8, LANG-2) — it opens on
 * two EQUAL doors (`FirstFarmDoors`): "माझं शेत सुरू करायचं" or "मला बोलावलं आहे". The first opens the
 * same 2-field create-farm form as before (his name — kept, founder keep-every-feature rule — and the
 * farm's name), now in the first run's look, in ONE language and with ONE "← मागे" back to the doors.
 * The second opens the ONE join door (`JoinByCodeScreen`, via `onJoinViaQr`). There is no role
 * question anywhere: the creator is मालक; a joiner's role is the owner's call.
 *
 * API: POST /bootstrap/first-farm  { farmName, farmerName }
 *   → BootstrapFirstFarmResponse.farmId drives the completion callback.
 *
 * Spec: getmyfarms-user-scoped-rls-read-path-2026-06-06
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    bootstrapFirstFarm,
    isInviteApiError,
    type BootstrapFirstFarmResponse,
} from '../qr/inviteApi';
import { type WaitingSeat } from './PendingJoinRequests';
import FirstFarmDoors from './FirstFarmDoors';
import { WaitingInvitations } from '../../invitations/WaitingInvitations';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { firstRunCopy, type FirstRunCopy } from '../firstRun/firstRunCopy';
import { FirstRunGlass, FirstRunHeading, FirstRunShell, GreenButton, Rise } from '../firstRun/FirstRunShell';

/**
 * The line for a failed POST /bootstrap/first-farm. The endpoint's own refusals
 * (FirstFarmBootstrapEndpoints.cs): 401 (sign-in no longer valid) and 403
 * `bootstrap.phone_not_verified`; its 400 `bootstrap.invalid_payload` (no farm name) cannot be sent
 * from this form (the button needs a name). A request that never got an answer is the internet.
 */
export const createFailedLine = (err: unknown, c: FirstRunCopy['create']): string => {
    if (!isInviteApiError(err)) return c.failed;
    if (err.status === 401) return c.failedSignIn;
    if (err.error === 'bootstrap.phone_not_verified') return c.failedPhone;
    return c.failedServer;
};

interface MinimalOnboardingProps {
    isOpen: boolean;
    onComplete: (result: BootstrapFirstFarmResponse) => void;
    onJoinViaQr: () => void;
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F2) — seats that grant nothing yet: farms this
     * person asked to join (typed code) that the owner has not approved, or a paused seat. He
     * still has no farm, so this screen stays; it says what each one is (a request waiting, or
     * work paused — never one for the other) instead of looking as if nothing happened.
     */
    pendingSeats?: WaitingSeat[];
    /** Withdraws a waiting request (server self-exit) and refreshes the farm lists. */
    onWithdrawRequest?: (farmId: string) => Promise<void>;
    /** Back from the doors to the phone number (signs out). Not drawn without it. */
    onBack?: () => void;
    /** spec: plr-d10 lane MU-2 — an invitation was answered (in at once, or a request): the caller refreshes his farms. */
    onInvitationAnswered?: () => void;
}

const INPUT = 'min-h-[56px] w-full rounded-2xl bg-white px-4 text-[19px] font-extrabold text-stone-900 outline-none ring-1 ring-stone-300 placeholder:font-semibold placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-500 disabled:opacity-60';

const MinimalOnboarding: React.FC<MinimalOnboardingProps> = ({
    isOpen,
    onComplete,
    onJoinViaQr,
    pendingSeats = [],
    onWithdrawRequest,
    onBack,
    onInvitationAnswered,
}) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const c = firstRunCopy(language);
    const [step, setStep] = useState<'doors' | 'create'>('doors');
    const [farmerName, setFarmerName] = useState('');
    const [farmName, setFarmName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const farmerNameRef = useRef<HTMLInputElement | null>(null);

    // Every opening starts at the two doors with an empty form.
    useEffect(() => {
        if (isOpen) {
            setStep('doors');
            setFarmerName('');
            setFarmName('');
            setError(null);
            setLoading(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && step === 'create') {
            const t = setTimeout(() => farmerNameRef.current?.focus(), 150);
            return () => clearTimeout(t);
        }
    }, [isOpen, step]);

    if (!isOpen) return null;

    if (step === 'doors') {
        return (
            <FirstFarmDoors
                onStartOwnFarm={() => setStep('create')}
                onJoin={onJoinViaQr}
                onBack={onBack}
                pendingSeats={pendingSeats}
                onWithdrawRequest={onWithdrawRequest}
                invitations={<WaitingInvitations onAnswered={onInvitationAnswered} />}
            />
        );
    }

    const canSubmit = farmerName.trim().length >= 1 && farmName.trim().length >= 1 && !loading;

    const submit = async () => {
        if (!canSubmit) return;
        setError(null);
        setLoading(true);
        try {
            // village is not collected at this minimal step — pass undefined.
            const result = await bootstrapFirstFarm(farmName, undefined, farmerName);
            onComplete(result);
        } catch (err) {
            // The server's own message is English: shown only to someone who chose English. In Marathi
            // each known refusal has its own line (round-1 review FR-3-b) — "check the internet" only
            // when the request never reached the server.
            if (language === 'en' && isInviteApiError(err)) setError(err.message);
            else setError(createFailedLine(err, c.create));
        } finally {
            setLoading(false);
        }
    };

    return (
        /* z-[60]: above BottomNavigation (z-50); the join door (z-[70]) opens over it. */
        <FirstRunShell testId="first-farm-create" layer="z-[60]" onBack={loading ? undefined : () => setStep('doors')} backLabel={c.back}>
            <form onSubmit={e => { e.preventDefault(); void submit(); }} noValidate className="flex flex-1 flex-col">
                <Rise className="mt-4"><FirstRunHeading>{c.create.title}</FirstRunHeading></Rise>
                <Rise d={0.1}><p className="m-0 mt-1 text-center text-[14.5px] font-semibold text-stone-600">{c.create.line}</p></Rise>
                <Rise d={0.15} className="mt-6">
                    <FirstRunGlass className="space-y-4">
                        <label className="block" htmlFor="mo-farmer-name">
                            <span className="text-[14px] font-extrabold text-stone-700">{c.create.farmerName}</span>
                            <input id="mo-farmer-name" ref={farmerNameRef} type="text" value={farmerName}
                                onChange={e => { setFarmerName(e.target.value); setError(null); }}
                                maxLength={100} placeholder={c.create.farmerNamePlaceholder} autoComplete="name" disabled={loading}
                                className={`mt-1 ${INPUT}`} />
                        </label>
                        <label className="block" htmlFor="mo-farm-name">
                            <span className="text-[14px] font-extrabold text-stone-700">{c.create.farmName}</span>
                            <input id="mo-farm-name" type="text" value={farmName}
                                onChange={e => { setFarmName(e.target.value); setError(null); }}
                                maxLength={120} placeholder={c.create.farmNamePlaceholder} autoComplete="off" disabled={loading}
                                className={`mt-1 ${INPUT}`} />
                        </label>
                        {error && (
                            <p role="alert" data-testid="first-farm-create-error" className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-700">
                                {error}
                            </p>
                        )}
                    </FirstRunGlass>
                </Rise>
                <div className="flex-1" />
                <Rise d={0.3} className="mt-6">
                    <GreenButton type="submit" onClick={() => undefined} disabled={!canSubmit} testId="first-farm-create-submit">
                        {loading ? c.create.submitting : c.create.submit}
                    </GreenButton>
                </Rise>
            </form>
        </FirstRunShell>
    );
};

export default MinimalOnboarding;
