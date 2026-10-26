/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-1, LANG-1) — स्वागत, the FIRST screen
 * on a phone, before login (PLR-D9 T8: "स्वागत (legacy look: DawnScene, the farmer, gold heading;
 * language) → … मोबाईल + OTP"). Port of the approved preview `FirstRunFlow.tsx` welcome step.
 *
 * The language chips set the app's language at once (this screen re-reads in it) and the choice is
 * kept on the phone (`FirstRunDeviceStore`), so it survives sign-in — the signed-in farmer's database
 * is a different one from the pre-login database this screen runs on.
 *
 * Nothing personal is asked or stored here; consent stays the ONE tick on the phone-number screen.
 */
import React from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { Language } from '../../../i18n/language';
import { Tap } from '../../../shared/components/ui/placeUi';
import { FirstRunGlass, FirstRunHeading, FirstRunShell, GreenButton, Rise } from './FirstRunShell';
import { firstRunCopy } from './firstRunCopy';

/** Each language is named in its own script — a choice of language, not a doubled label. */
const LANGUAGES: readonly (readonly [Language, string])[] = [['mr', 'मराठी'], ['en', 'English']];

const FirstRunWelcome: React.FC<{ onStart: () => void }> = ({ onStart }) => {
    const lang = useOptionalLanguage();
    const language: Language = lang?.language ?? 'mr';
    const c = firstRunCopy(language).welcome;
    const [imgFailed, setImgFailed] = React.useState(false);

    return (
        <FirstRunShell testId="first-run-welcome">
            <Rise><div className="flex justify-center"><img src="/brand/logo-full.webp" alt="" className="h-12 object-contain" draggable={false} /></div></Rise>
            <Rise d={0.15} className="mt-4"><FirstRunHeading gold testId="first-run-hello">{c.hello}</FirstRunHeading></Rise>
            <Rise d={0.25}><p className="m-0 mt-1 text-center text-[15px] font-bold text-stone-700" data-testid="first-run-tagline">{c.tagline}</p></Rise>
            <Rise d={0.1} className="flex min-h-[220px] flex-1 items-end justify-center">
                {!imgFailed && (
                    <img src="/brand/farmer-welcome.webp" alt="" aria-hidden="true" onError={() => setImgFailed(true)}
                        className="pointer-events-none max-h-[300px] w-full object-contain object-bottom"
                        style={{ filter: 'drop-shadow(0 12px 20px rgba(6,78,59,.22))' }} />
                )}
            </Rise>
            <Rise d={0.45}>
                <FirstRunGlass>
                    <p className="m-0 text-center text-[15px] font-bold leading-snug text-stone-800" data-testid="first-run-sathi">
                        {c.sathiLead}<b className="text-emerald-700">{c.sathiName}</b>{c.sathiTail}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={c.languageLabel}>
                        {LANGUAGES.map(([code, label]) => (
                            <Tap key={code} onClick={() => lang?.setLanguage(code)} aria-pressed={language === code}
                                data-testid={`first-run-lang-${code}`} lang={code}
                                className={`min-h-[48px] rounded-2xl text-[16px] font-extrabold ${language === code ? 'bg-emerald-700 text-white' : 'bg-white text-stone-800 ring-1 ring-stone-300'}`}>
                                {label}
                            </Tap>
                        ))}
                    </div>
                </FirstRunGlass>
            </Rise>
            <Rise d={0.6} className="mt-4">
                <GreenButton onClick={onStart} testId="first-run-start">{c.start}</GreenButton>
            </Rise>
        </FirstRunShell>
    );
};

export default FirstRunWelcome;
