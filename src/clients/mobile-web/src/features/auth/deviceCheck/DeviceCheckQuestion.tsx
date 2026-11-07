/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85).
 *
 * The one-time question on a NEW phone: "हे खातं ‹नाव› यांचं आहे — तुम्ही तेच आहात का?" with होय / नाही.
 *
 * It is shown only when the server says so (the sign-in or boot-refresh answer's `deviceCheckRequired`): a phone the
 * account has never confirmed. His own phone is never asked, and a phone that said होय is never asked again — the
 * server remembers it, so this screen keeps nothing on the device. It comes BEFORE anything of the farm is shown or
 * downloaded: until होय the app is not signed in (no farm list, no sync), and the server serves that phone nothing.
 *
 *   होय → the server opens the session; `onConfirmed` stores it and the app continues as after any sign-in.
 *   नाही → the server ends this phone's sign-in (the account and the owner's other phones are untouched) and this
 *         screen says "हे खातं तुमचं नाही. नंबर बदलला असेल तर श्रमसफल मदतीशी संपर्क करा." with one "मागे".
 *
 * Presentational plus one call; the look is the first run's (FirstRunShell), one language at a time.
 */
import React, { useState } from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { AuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { FirstRunBack, FirstRunGlass, FirstRunShell, GreenButton, Rise } from '../../onboarding/firstRun/FirstRunShell';
import { Tap } from '../../../shared/components/ui/placeUi';
import { answerDeviceCheck, type DeviceCheckAnswer } from '../data/deviceCheckClient';
import { deviceCheckCopy } from './deviceCheckCopy';

interface DeviceCheckQuestionProps {
    /** The account's display name, as the server gave it with the question. */
    accountName: string;
    /** होय was accepted: this session opens the account. */
    onConfirmed: (session: AuthSession) => void;
    /** Signed out: after नाही (its "मागे"), or when the question was no longer open on the server. */
    onFinished: () => void;
}

const DeviceCheckQuestion: React.FC<DeviceCheckQuestionProps> = ({ accountName, onConfirmed, onFinished }) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const c = deviceCheckCopy(language);
    const [declined, setDeclined] = useState(false);
    const [sending, setSending] = useState<DeviceCheckAnswer | null>(null);
    const [failed, setFailed] = useState(false);

    const answer = async (choice: DeviceCheckAnswer) => {
        if (sending) return;
        setSending(choice);
        setFailed(false);
        try {
            const outcome = await answerDeviceCheck(choice);
            if (outcome.kind === 'confirmed') {
                onConfirmed(outcome.session);
            } else if (outcome.kind === 'declined') {
                setDeclined(true);
            } else if (outcome.kind === 'expired') {
                onFinished();
            } else {
                setFailed(true);
            }
        } catch (err) {
            // Lands in the console (and the client error report); the farmer sees "try again", never a dead screen.
            console.error('[DeviceCheckQuestion] the answer could not be sent', err);
            setFailed(true);
        } finally {
            setSending(null);
        }
    };

    if (declined) {
        return (
            <FirstRunShell testId="device-check-declined-screen">
                <Rise d={0.05} className="mt-10">
                    <FirstRunGlass>
                        <p data-testid="device-check-declined" role="status" className="m-0 text-[18px] font-extrabold leading-snug text-stone-900">
                            {c.declined}
                        </p>
                    </FirstRunGlass>
                </Rise>
                <div className="mt-6">
                    <FirstRunBack onBack={onFinished} label={c.back} testId="device-check-back" />
                </div>
            </FirstRunShell>
        );
    }

    return (
        <FirstRunShell testId="device-check">
            <Rise d={0.05} className="mt-10">
                <FirstRunGlass>
                    <p data-testid="device-check-question" className="m-0 text-[20px] font-extrabold leading-snug text-stone-900">
                        {c.question(accountName.trim() || '—')}
                    </p>
                </FirstRunGlass>
            </Rise>
            <Rise d={0.15} className="mt-6 space-y-3">
                <GreenButton onClick={() => { void answer('yes'); }} testId="device-check-yes" disabled={sending !== null}>
                    {sending === 'yes' ? c.sending : c.yes}
                </GreenButton>
                <Tap
                    onClick={() => { void answer('no'); }}
                    data-testid="device-check-no"
                    disabled={sending !== null}
                    className="flex w-full items-center justify-center rounded-full border border-stone-300 bg-white py-[15px] text-[17px] font-black text-stone-800 shadow-sm disabled:opacity-50"
                >
                    {sending === 'no' ? c.sending : c.no}
                </Tap>
                {failed && (
                    <p data-testid="device-check-failed" role="alert" className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-800">
                        {c.failed}
                    </p>
                )}
            </Rise>
        </FirstRunShell>
    );
};

export default DeviceCheckQuestion;
