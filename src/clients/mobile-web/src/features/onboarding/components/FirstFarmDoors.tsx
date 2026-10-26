/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-3 / MU-1, FR-7, FR-8) — the screen a
 * signed-in person with NO farm sees: two EQUAL big doors (PLR-D7 §5: "two doors - my own farm / I
 * was invited… No role question at login"). Port of the approved preview's "तुम्ही इथे कसे आलात?"
 * step (plr-d1a `FirstRunFlow.tsx` 'who'), wired to the REAL flows:
 *   - "माझं शेत सुरू करायचं" → the existing create-farm form (POST /bootstrap/first-farm); he is मालक;
 *   - "मला बोलावलं आहे"     → the existing join door `JoinByCodeScreen` (typed farm code, or the QR).
 * Nobody picks a role here. A join request still waiting for the owner is said on top in the words
 * the join door already uses ("विनंती पाठवली — …वाट पाहा"), and every waiting seat stays listed with
 * its withdraw (PendingJoinRequests) — FR-7's "the waiting message instead" of a role welcome.
 *
 * Round-1 review (FR-3-a / F3): the doors' "← मागे" signs out (the step before is the phone number),
 * which used to happen on one tap — and a new OTP to come back. It now asks first ("बाहेर पडायचं?"),
 * with "इथेच राहा" beside it. (F6): the waiting words follow the chosen language like the rest.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Clock3, LogOut, QrCode, Sprout } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { Tap } from '../../../shared/components/ui/placeUi';
import { FirstRunGlass, FirstRunHeading, FirstRunShell, Rise } from '../firstRun/FirstRunShell';
import { firstRunCopy } from '../firstRun/firstRunCopy';
import { JOIN_BY_CODE_COPY } from './JoinByCodeScreen';
import PendingJoinRequests, { waitingSeatKind, type WaitingSeat } from './PendingJoinRequests';

/** The join door's own "request sent" words, in English for someone who chose English. */
const WAITING_EN = {
    sentTitle: 'Request sent',
    sentLine: 'The owner will decide your role and approve it — until then, please wait',
} as const;

export interface FirstFarmDoorsProps {
    onStartOwnFarm: () => void;
    onJoin: () => void;
    /** The step before this one is the phone number: back signs out to it. Not drawn without it. */
    onBack?: () => void;
    pendingSeats?: WaitingSeat[];
    onWithdrawRequest?: (farmId: string) => Promise<void>;
}

const FirstFarmDoors: React.FC<FirstFarmDoorsProps> = ({ onStartOwnFarm, onJoin, onBack, pendingSeats = [], onWithdrawRequest }) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const c = firstRunCopy(language);
    const sent = language === 'en' ? WAITING_EN : JOIN_BY_CODE_COPY;
    const waiting = pendingSeats.some(s => waitingSeatKind(s.status) === 'request');
    const [askingToLeave, setAskingToLeave] = useState(false);
    // Round-2 review A11Y-1: the question takes the focus (on "इथेच राहा", the safe answer) so a
    // screen-reader or keyboard user who pressed मागे lands on it; staying hands the focus back to मागे.
    const askRef = useRef<HTMLDivElement | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    useEffect(() => {
        if (askingToLeave) askRef.current?.querySelector<HTMLButtonElement>('[data-testid="first-farm-leave-no"]')?.focus();
    }, [askingToLeave]);
    const askToLeave = () => {
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setAskingToLeave(true);
    };
    const stay = () => {
        setAskingToLeave(false);
        returnFocusRef.current?.focus();
    };

    return (
        <FirstRunShell testId="first-farm-doors" layer="z-[60]" onBack={onBack ? askToLeave : undefined} backLabel={c.back}>
            {askingToLeave && onBack && (
                <Rise className="mt-2">
                    <FirstRunGlass testId="first-farm-leave" className="text-center">
                        <div ref={askRef} role="alertdialog" aria-labelledby="first-farm-leave-title" aria-describedby="first-farm-leave-line"
                            onKeyDown={e => { if (e.key === 'Escape') stay(); }}>
                            <p id="first-farm-leave-title" className="m-0 text-[19px] font-extrabold text-stone-900">{c.doors.leaveTitle}</p>
                            <p id="first-farm-leave-line" className="m-0 mt-1 text-[15px] font-bold leading-snug text-stone-700">{c.doors.leaveLine}</p>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <Tap onClick={stay} data-testid="first-farm-leave-no"
                                    className="flex min-h-[52px] items-center justify-center rounded-full bg-emerald-600 px-3 text-[16px] font-extrabold text-white">
                                    {c.doors.leaveNo}
                                </Tap>
                                <Tap onClick={onBack} data-testid="first-farm-leave-yes" rippleColor="rgba(225,29,72,0.15)"
                                    className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 text-[16px] font-extrabold text-rose-700">
                                    <LogOut size={18} aria-hidden="true" />{c.doors.leaveYes}
                                </Tap>
                            </div>
                        </div>
                    </FirstRunGlass>
                </Rise>
            )}
            {waiting && (
                <Rise className="mt-2">
                    <FirstRunGlass testId="first-farm-waiting" className="text-center">
                        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-700">
                            <Clock3 size={26} aria-hidden="true" />
                        </span>
                        <p className="m-0 mt-2 text-[19px] font-extrabold text-stone-900">{sent.sentTitle}</p>
                        <p className="m-0 mt-1 text-[15px] font-bold leading-snug text-stone-700">{sent.sentLine}</p>
                    </FirstRunGlass>
                </Rise>
            )}
            <Rise className="mt-4"><FirstRunHeading testId="first-farm-doors-title">{c.doors.title}</FirstRunHeading></Rise>
            <Rise d={0.1}><p className="m-0 mt-1 text-center text-[14.5px] font-semibold text-stone-600">{c.doors.hint}</p></Rise>
            <div className="mt-6 space-y-3">
                <Rise d={0.2}>
                    <Tap onClick={onStartOwnFarm} data-testid="door-own-farm" rippleColor="rgba(255,255,255,0.3)"
                        className="flex min-h-[132px] w-full items-center gap-4 rounded-[28px] bg-gradient-to-br from-emerald-600 to-emerald-800 p-4 text-left text-white shadow-[0_12px_28px_-10px_rgba(4,120,87,0.6)]">
                        <span className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full bg-white text-emerald-700"><Sprout size={36} aria-hidden="true" /></span>
                        <span>
                            <span className="block text-[22px] font-extrabold leading-tight">{c.doors.ownTitle}</span>
                            <span className="mt-1 block text-[14px] font-semibold text-emerald-50">{c.doors.ownLine}</span>
                        </span>
                    </Tap>
                </Rise>
                <Rise d={0.3}>
                    <Tap onClick={onJoin} data-testid="door-invited"
                        className="flex min-h-[132px] w-full items-center gap-4 rounded-[28px] border-2 border-[#1448E6] bg-white p-4 text-left text-stone-900 shadow-sm">
                        <span className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full bg-[#1448E6]/10 text-[#1448E6]"><QrCode size={36} aria-hidden="true" /></span>
                        <span>
                            <span className="block text-[22px] font-extrabold leading-tight">{c.doors.joinTitle}</span>
                            <span className="mt-1 block text-[14px] font-semibold text-stone-600">{c.doors.joinLine}</span>
                        </span>
                    </Tap>
                </Rise>
            </div>
            {pendingSeats.length > 0 && (
                <div className="mt-6">
                    <PendingJoinRequests seats={pendingSeats} onWithdraw={onWithdrawRequest} testId="minimal-onboarding-pending" language={language} />
                </div>
            )}
        </FirstRunShell>
    );
};

export default FirstFarmDoors;
