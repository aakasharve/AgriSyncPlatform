/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R3 lane S2, the founder's pick V6a-B (27 Nov; R1 plan §05-§06,
 * drawing `repair\r3\design\screen-choices-final.html` → V6a-B). The first-run dawn look with ONE glass card that changes in place:
 *   1. "तुमच्या शेताचं नाव काय आहे?" — one field, one button "शेत तयार करा". The save is the same server call as before
 *      (POST /bootstrap/first-farm); no server change. His own name is no longer asked here (the OTP screen asks it).
 *   2. ONLY once the server has answered "created": the gold "अभिनंदन!", the farm's new nameboard (`FarmNameBoard`, the
 *      header's own board, with the name the SERVER sent back), "तुमचं ‹नाव› श्रमसफलमध्ये तयार आहे. चला, सुरुवात करूया." and
 *      "सुरू करूया" (the first run's existing `welcome.start`). It replaces the old "अभिनंदन! … तुम्ही … चे मालक आहात" screen
 *      for the person who made the farm (R1 §05): never an owner claim.
 * A failed save keeps card 1 with the honest reason and what he typed; no congratulations. A farm the server says it had made
 * BEFORE (`wasAlreadyBootstrapped`: a retry, or a farm he may have left since) is not congratulated as new — it goes straight on.
 */
import React, { useEffect, useRef, useState } from 'react';
import { bootstrapFirstFarm, isInviteApiError, type BootstrapFirstFarmResponse } from '../qr/inviteApi';
import type { Language } from '../../../i18n/language';
import { firstRunCopy, type FirstRunCopy } from '../firstRun/firstRunCopy';
import { FirstRunGlass, FirstRunHeading, FirstRunShell, GreenButton, Rise } from '../firstRun/FirstRunShell';
import FarmNameBoard from '../../context/components/FarmNameBoard';

/**
 * The line for a failed POST /bootstrap/first-farm. The endpoint's own refusals (FirstFarmBootstrapEndpoints.cs): 401 (sign-in
 * no longer valid) and 403 `bootstrap.phone_not_verified`; its 400 `bootstrap.invalid_payload` (no farm name) cannot be sent
 * from this card (the button needs a name). A request that never got an answer is the internet.
 */
export const createFailedLine = (err: unknown, c: FirstRunCopy['create']): string => {
    if (!isInviteApiError(err)) return c.failed;
    if (err.status === 401) return c.failedSignIn;
    if (err.error === 'bootstrap.phone_not_verified') return c.failedPhone;
    return c.failedServer;
};

const INPUT = 'min-h-[56px] w-full rounded-2xl bg-white px-4 text-[19px] font-extrabold text-stone-900 outline-none ring-1 ring-stone-300 placeholder:font-semibold placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-500 disabled:opacity-60';
const QUESTION_ID = 'farm-name-question';

export interface FarmNameCardProps {
    language: Language;
    /** Card 1's "← मागे" (to the two doors). Not drawn while saving, and never on the congratulations. */
    onBack: () => void;
    /** The farm is made and he tapped "सुरू करूया" (or the server had made it before): the first run goes on. */
    onDone: (result: BootstrapFirstFarmResponse) => void;
}

export const FarmNameCard: React.FC<FarmNameCardProps> = ({ language, onBack, onDone }) => {
    const c = firstRunCopy(language);
    const [farmName, setFarmName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState<BootstrapFirstFarmResponse | null>(null);
    const fieldRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        const t = setTimeout(() => fieldRef.current?.focus(), 150);
        return () => clearTimeout(t);
    }, []);

    const canSubmit = farmName.trim().length >= 1 && !saving;
    const submit = async () => {
        if (!canSubmit) return;
        setError(null);
        setSaving(true);
        try {
            const result = await bootstrapFirstFarm(farmName.trim());
            if (result.wasAlreadyBootstrapped) onDone(result);
            else setCreated(result);
        } catch (err) {
            // The server's own message is English: shown only to someone who chose English. In Marathi each known refusal has
            // its own line — "check the internet" only when the request never reached the server.
            if (language === 'en' && isInviteApiError(err)) setError(err.message);
            else setError(createFailedLine(err, c.create));
        } finally {
            setSaving(false);
        }
    };

    if (created) {
        const name = created.farmName.trim() || farmName.trim();
        return (
            /* z-[60]: above BottomNavigation (z-50); the join door (z-[70]) opens over it. */
            <FirstRunShell testId="first-farm-create" layer="z-[60]">
                <div className="flex flex-1 flex-col">
                    <div className="flex-1" />
                    <Rise>
                        <FirstRunGlass testId="farm-ready" className="p-4">
                            <FirstRunHeading gold testId="farm-ready-heading">{c.hello.heading}</FirstRunHeading>
                            <div className="mb-1 mt-3.5 flex">
                                <FarmNameBoard farmName={name} onOpenFarmSwitcher={() => undefined} showSubtitle={false} canSwitch={false} />
                            </div>
                            <p data-testid="farm-ready-line" className="m-0 mt-2.5 text-center text-[20px] font-extrabold leading-normal text-stone-900">
                                {c.create.readyBefore}<b data-testid="farm-ready-name" className="text-emerald-800">{name}</b>{c.create.readyAfter}
                            </p>
                            <div className="mt-4">
                                <GreenButton onClick={() => onDone(created)} testId="farm-ready-start">{c.welcome.start}</GreenButton>
                            </div>
                        </FirstRunGlass>
                    </Rise>
                    <div className="flex-[1.4]" />
                </div>
            </FirstRunShell>
        );
    }

    return (
        <FirstRunShell testId="first-farm-create" layer="z-[60]" onBack={saving ? undefined : onBack} backLabel={c.back}>
            <form onSubmit={e => { e.preventDefault(); void submit(); }} noValidate className="flex flex-1 flex-col">
                <div className="flex-1" />
                <Rise>
                    <FirstRunGlass className="p-4">
                        <h1 id={QUESTION_ID} data-testid="farm-name-question" className="m-0 text-center font-serif text-[27px] font-bold leading-tight text-emerald-900">
                            {c.create.question}
                        </h1>
                        <input ref={fieldRef} type="text" value={farmName} aria-labelledby={QUESTION_ID}
                            onChange={e => { setFarmName(e.target.value); setError(null); }}
                            maxLength={120} placeholder={c.create.farmNamePlaceholder} autoComplete="off" disabled={saving}
                            className={`mt-4 ${INPUT}`} />
                        {error && (
                            <p role="alert" data-testid="first-farm-create-error" className="m-0 mt-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-700">
                                {error}
                            </p>
                        )}
                        <div className="mt-4">
                            <GreenButton type="submit" onClick={() => undefined} disabled={!canSubmit} testId="first-farm-create-submit">
                                {saving ? c.create.submitting : c.create.submit}
                            </GreenButton>
                        </div>
                    </FirstRunGlass>
                </Rise>
                <div className="flex-[1.4]" />
            </form>
        </FirstRunShell>
    );
};

export default FarmNameCard;
