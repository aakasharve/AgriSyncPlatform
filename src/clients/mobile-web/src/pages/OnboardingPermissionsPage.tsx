/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OnboardingPermissionsPage — फोनच्या परवानग्या, the DEVICE-PERMISSIONS EXPLAINER. Themed to match
 * the first run (DawnScene, the pointing farmer) so onboarding reads as one product.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-6, FR-8, LANG-2) — it now comes AFTER
 * the farm is created or joined (PLR-D9 T8), lists the microphone FIRST ("सगळ्यात महत्त्वाचं"), then
 * location for the weather and the camera for bills / QR (the approved preview's three rows and words),
 * in ONE language — no "(Location)" beside "स्थान". The old fourth row "साठवण (Storage)" is gone: it
 * was not a permission the app asks for, and its tick was drawn as granted without reading anything
 * (P4). The preview's per-row "परवानगी द्या" taps are deliberately NOT ported: they would fire OS
 * prompts here, which the rule below forbids. Each row only SAYS what the OS reports today — and a
 * permission the phone has REFUSED says to turn it on in the phone's settings, never "we will ask
 * when it is used": once refused, the OS does not ask again (round-1 review F5).
 *
 * NO "← मागे" ON THIS STEP — a deviation from FR-8 / PLR-D9 T8 ("every step after the welcome has a
 * back"), put to the founder (round-1 review F1 / FR-8-a). In the approved preview this step went back
 * to the farm-name form or the invitation. In the real app the step before has already HAPPENED on
 * the server: the farm is created (POST /bootstrap/first-farm, which answers the same farm again on a
 * second press and has no rename) or the owner has let the joiner in. A back to that form would offer
 * a change the app cannot make (P5), so none is drawn. The role welcome after this step does go back
 * here (AppRouter).
 *
 * spec: dfes-companion-2026-07-11 (wave-4.3) — IT IS NOT "the consent screen", and it asks for nothing.
 *
 * An OS permission is not DPDP consent. This screen only tells the farmer which device capabilities
 * the app will ask for LATER, at the moment he uses the feature that needs one — see
 * features/consent/separation/devicePermissions.ts.
 *
 * What changed and why (wave-4.3): this screen used to fire getUserMedia for microphone AND camera
 * plus a geolocation prompt in one sweep behind a single "grant all permissions" button. That asks for
 * three capabilities before he has seen one reason to grant any of them, which is how they get refused
 * — and a refusal here is one he has no context to reconsider.
 */
import React, { useState, useEffect } from 'react';
import { Shield, MapPin, Mic, Camera, Check, Lock } from 'lucide-react';
import { useUiPref } from '../shared/hooks/useUiPref';
import DawnScene from './onboarding/DawnScene';
import { readDevicePermission } from '../features/consent/separation/devicePermissions';
import { useOptionalLanguage } from '../i18n/LanguageContext';
import { firstRunCopy } from '../features/onboarding/firstRun/firstRunCopy';

interface OnboardingPermissionsPageProps {
    onComplete: () => void;
}

/** What a row can honestly say: the OS allowed it, the OS refused it, or it will be asked at first use. */
type RowState = 'granted' | 'denied' | 'later';

const toRowState = (outcome: string): RowState =>
    outcome === 'granted' ? 'granted' : outcome === 'denied' ? 'denied' : 'later';

const OnboardingPermissionsPage: React.FC<OnboardingPermissionsPageProps> = ({ onComplete }) => {
    // Sub-plan 04 Task 3 — persisted in Dexie's uiPrefs via useUiPref.
    const [, setPermissionsGranted] = useUiPref<boolean>('shramsafal_permissions_granted', false);
    const c = firstRunCopy(useOptionalLanguage()?.language).permissions;
    const [imgFailed, setImgFailed] = useState(false);
    const [mounted, setMounted] = useState(false);

    // 'unavailable' (the OS would not say) and 'prompt' both read as "asked when used".
    const [permissions, setPermissions] = useState<Record<'location' | 'microphone' | 'camera', RowState>>({
        location: 'later',
        microphone: 'later',
        camera: 'later',
    });

    useEffect(() => {
        let cancelled = false;
        // READ ONLY — readDevicePermission never prompts. Rendering this screen must not be
        // able to trigger an OS dialog as a side effect; that is the whole point of keeping
        // the read and the request as two different functions.
        void Promise.all([
            readDevicePermission('microphone'),
            readDevicePermission('location'),
            readDevicePermission('camera'),
        ]).then(([microphone, location, camera]) => {
            if (cancelled) return;
            setPermissions({
                location: toRowState(location),
                microphone: toRowState(microphone),
                camera: toRowState(camera),
            });
        });
        const t = setTimeout(() => setMounted(true), 40);
        return () => { cancelled = true; clearTimeout(t); };
    }, []);

    // Nothing is requested here. The pref records only that the explainer was seen —
    // it has never meant "the OS granted anything", and now it cannot be misread as
    // meaning "the farmer consented" either.
    const acknowledge = () => {
        setPermissionsGranted(true);
        onComplete();
    };

    // Microphone first — the app's one essential (PLR-D9 T8, founder words "सगळ्यात महत्त्वाचं").
    const CARDS = [
        { id: 'microphone', icon: <Mic size={19} />, title: c.micTitle, desc: c.micLine, state: permissions.microphone },
        { id: 'location', icon: <MapPin size={19} />, title: c.locationTitle, desc: c.locationLine, state: permissions.location },
        { id: 'camera', icon: <Camera size={19} />, title: c.cameraTitle, desc: c.cameraLine, state: permissions.camera },
    ];

    const anim = (name: string, dur: string, delay: string): React.CSSProperties =>
        mounted ? { animation: `${name} ${dur} cubic-bezier(.16,1,.3,1) ${delay} both` } : { opacity: 0 };

    return (
        <div data-testid="first-run-permissions" className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#F4FCF8] pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] select-none">
            <style>{`
                @keyframes cs-rise { from{transform:translateY(30px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes cs-up { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
                @media (prefers-reduced-motion:reduce){ [data-cs-anim]{animation-duration:.01ms!important;animation-delay:0ms!important} }
                .cs-mascot-slot{container-type:size}
                @container (max-height:120px){ .cs-mascot-img{display:none} }
            `}</style>

            <DawnScene lit={mounted} />

            {/* HEADER — the title. No "← मागे" here: see the file header (the step before is done on the server). */}
            <div data-cs-anim className="relative z-10 mx-auto w-full max-w-[440px] px-6 pt-6" style={anim('cs-up', '.5s', '.05s')}>
                <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15">
                        <Shield size={22} strokeWidth={2} />
                    </span>
                    <div>
                        <h1 className="font-serif text-[22px] font-bold leading-tight text-stone-800">{c.title}</h1>
                        <p className="mt-0.5 font-sans text-[12.5px] font-medium text-stone-500">{c.line}</p>
                    </div>
                </div>
            </div>

            {/* PERMISSION ROWS — directly under the header (natural reading order),
                scrollable on short screens. Sized to their content (flex-initial) so the
                space left below them belongs to the farmer slot that follows. They are NOT
                buttons: nothing is asked here, so nothing here can be tapped to ask. */}
            <div className="relative z-10 min-h-0 flex-initial overflow-y-auto scrollbar-hide">
              <ul className="m-0 mx-auto flex w-full max-w-[440px] list-none flex-col space-y-3 px-6 py-5">
                {CARDS.map((card, idx) => (
                    <li
                        key={card.id}
                        data-cs-anim
                        data-testid={`permission-row-${card.id}`}
                        className="flex items-center gap-3.5 rounded-[18px] border border-stone-200/70 bg-white/80 p-3.5 shadow-[0_6px_18px_-12px_rgba(6,78,59,0.25)] backdrop-blur-sm"
                        style={anim('cs-up', '.5s', `${0.15 + idx * 0.08}s`)}
                    >
                        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/12">
                            {card.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="font-sans text-[15px] font-bold text-stone-800">{card.title}</p>
                            <p className="mt-0.5 font-sans text-[12.5px] font-medium leading-snug text-stone-500">{card.desc}</p>
                        </div>
                        <span className="flex-shrink-0 pl-1" data-testid={`permission-state-${card.id}`} data-state={card.state}>
                            {card.state === 'granted' ? (
                                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[12px] font-extrabold text-emerald-700">
                                    <Check size={14} strokeWidth={3} aria-hidden="true" />{c.given}
                                </span>
                            ) : card.state === 'denied' ? (
                                <span className="block max-w-[96px] text-right text-[11.5px] font-bold leading-tight text-amber-700">{c.offInSettings}</span>
                            ) : (
                                <span className="text-[11.5px] font-bold text-stone-400">{c.askLater}</span>
                            )}
                        </span>
                    </li>
                ))}
              </ul>
            </div>

            {/* pointing farmer — stands on the CTA dock and gestures at the button.
                He lives in the space BETWEEN the permission rows and the dock, never
                over them: he was positioned against the screen bottom and his head
                sat behind a card on a phone (founder report, APK 1.0.14).
                Same size as before when the space allows (52% of the width, at most
                212px); smaller when it does not; hidden when that space is under
                120px (see .cs-mascot-slot above), and on short screens, where the
                rows scroll, the slot is empty. */}
            <div
                data-cs-anim
                className="cs-mascot-slot pointer-events-none relative z-[5] min-h-0 flex-1"
                style={anim('cs-rise', '.8s', '.3s')}
            >
                {!imgFailed && (
                    <img
                        src="/brand/farmer-point.webp"
                        alt=""
                        aria-hidden="true"
                        onError={() => setImgFailed(true)}
                        className="cs-mascot-img absolute bottom-0 right-0 h-auto max-h-full w-[52%] max-w-[212px] object-contain object-right-bottom"
                        style={{
                            filter: 'drop-shadow(0 14px 20px rgba(6,78,59,.22))',
                            WebkitMaskImage: 'linear-gradient(180deg,#000 70%,transparent 97%)',
                            maskImage: 'linear-gradient(180deg,#000 70%,transparent 97%)',
                        }}
                    />
                )}
            </div>

            {/* CTA DOCK — one button; the line under it is information, not a second button that did the same thing */}
            <div className="relative z-20 mt-auto w-full">
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-[#F5FCF8] via-[#F5FCF8]/80 to-transparent" />
                <div data-cs-anim className="relative mx-auto w-full max-w-[440px] px-6 pb-6 pt-2" style={anim('cs-up', '.5s', '.5s')}>
                    <button
                        type="button"
                        data-testid="permissions-continue"
                        onClick={acknowledge}
                        className="flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[16px] font-sans text-[16px] font-black text-white shadow-[0_16px_34px_-10px_rgba(4,120,87,0.55)] ring-1 ring-white/25 transition-transform active:scale-[0.98]"
                    >
                        <Shield size={18} /> {c.next}
                    </button>
                    <p data-testid="permissions-type-instead" className="m-0 mt-2 w-full py-1 text-center font-sans text-[13px] font-bold text-stone-500">
                        {c.typeInstead}
                    </p>
                    <p className="mt-1 flex items-center justify-center gap-1.5 text-center font-sans text-[10.5px] font-semibold leading-normal text-stone-400">
                        <Lock size={10} /> {c.safe}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default OnboardingPermissionsPage;
