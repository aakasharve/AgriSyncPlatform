/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OnboardingPermissionsPage — the consent screen, shown after the Welcome and
 * before the app. Themed to match the Welcome + Login screens (light white /
 * pale-mint, green field band, stone text, emerald accents, serif heading /
 * sans body) so onboarding reads as one product. The real permission logic
 * (query + request + skip, writing shramsafal_permissions_granted) is unchanged.
 */
import React, { useState, useEffect } from 'react';
import { Shield, MapPin, Mic, Camera, HardDrive, Check, ChevronRight, Lock } from 'lucide-react';
import { useUiPref } from '../shared/hooks/useUiPref';
import DawnScene from './onboarding/DawnScene';

interface OnboardingPermissionsPageProps {
    onComplete: () => void;
}

const OnboardingPermissionsPage: React.FC<OnboardingPermissionsPageProps> = ({ onComplete }) => {
    // Sub-plan 04 Task 3 — persisted in Dexie's uiPrefs via useUiPref.
    const [, setPermissionsGranted] = useUiPref<boolean>('shramsafal_permissions_granted', false);
    const [imgFailed, setImgFailed] = useState(false);
    const [mounted, setMounted] = useState(false);

    const [permissions, setPermissions] = useState({
        location: false,
        microphone: false,
        camera: false,
    });

    const checkPermissions = async () => {
        try {
            const loc = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
            const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            const cam = await navigator.permissions.query({ name: 'camera' as PermissionName });
            setPermissions({
                location: loc.state === 'granted',
                microphone: mic.state === 'granted',
                camera: cam.state === 'granted',
            });
        } catch (e) {
            console.warn('Permissions query not fully supported', e);
        }
    };

    useEffect(() => {
        checkPermissions();
        const t = setTimeout(() => setMounted(true), 40);
        return () => clearTimeout(t);
    }, []);

    const requestAllPermissions = async () => {
        try {
            // Stop tracks immediately after the grant — onboarding only needs the
            // PERMISSION, not the live device (leaving the mic open broke the later
            // AudioRecorder getUserMedia with a false "mic not granted").
            try {
                const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                micStream.getTracks().forEach((track) => track.stop());
            } catch (e) {
                console.warn('Microphone permission denied', e);
            }
            try {
                const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
                camStream.getTracks().forEach((track) => track.stop());
            } catch (e) {
                console.warn('Camera permission denied', e);
            }
            try {
                if ('geolocation' in navigator) {
                    await new Promise((resolve) => {
                        navigator.geolocation.getCurrentPosition(resolve, resolve);
                    });
                }
            } catch (e) {
                console.warn('Location permission denied', e);
            }
            setPermissionsGranted(true);
            onComplete();
        } catch (error) {
            console.error('Error requesting permissions', error);
            setPermissionsGranted(true);
            onComplete();
        }
    };

    const skipOrSave = () => {
        setPermissionsGranted(true);
        onComplete();
    };

    const CARDS = [
        { id: 'location', icon: <MapPin size={19} />, mr: 'स्थान', en: 'Location', desc: 'शेत नकाशावर दाखवण्यासाठी आणि GPS पुरावा जोडण्यासाठी.', granted: permissions.location },
        { id: 'microphone', icon: <Mic size={19} />, mr: 'मायक्रोफोन', en: 'Microphone', desc: 'बोलून रोजच्या कामाची नोंद करण्यासाठी.', granted: permissions.microphone },
        { id: 'camera', icon: <Camera size={19} />, mr: 'कॅमेरा', en: 'Camera', desc: 'पावत्या आणि कीड-रोगाचे फोटो घेण्यासाठी.', granted: permissions.camera },
        { id: 'storage', icon: <HardDrive size={19} />, mr: 'साठवण', en: 'Storage', desc: 'नोंदी फोनमध्ये सुरक्षित ठेवण्यासाठी.', granted: true },
    ];

    const anim = (name: string, dur: string, delay: string): React.CSSProperties =>
        mounted ? { animation: `${name} ${dur} cubic-bezier(.16,1,.3,1) ${delay} both` } : { opacity: 0 };

    return (
        <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#F4FCF8] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] select-none">
            <style>{`
                @keyframes cs-rise { from{transform:translateY(30px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes cs-up { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
                @media (prefers-reduced-motion:reduce){ [data-cs-anim]{animation-duration:.01ms!important;animation-delay:0ms!important} }
            `}</style>

            <DawnScene lit={mounted} />

            {/* HEADER */}
            <div data-cs-anim className="relative z-10 mx-auto w-full max-w-[440px] px-6 pt-8" style={anim('cs-up', '.5s', '.05s')}>
                <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15">
                        <Shield size={22} strokeWidth={2} />
                    </span>
                    <div>
                        <h1 className="font-serif text-[21px] font-bold leading-tight text-stone-800">खालील गोष्टींची संमती द्या</h1>
                        <p className="mt-0.5 font-sans text-[12.5px] font-medium text-stone-500">श्रम साथी नीट चालण्यासाठी</p>
                    </div>
                </div>
            </div>

            {/* PERMISSION ROWS */}
            <div className="relative z-10 mx-auto w-full max-w-[440px] flex-1 space-y-2.5 overflow-y-auto px-6 py-6 scrollbar-hide">
                {CARDS.map((c, idx) => (
                    <div
                        key={c.id}
                        data-cs-anim
                        className="flex items-center gap-3.5 rounded-[18px] border border-stone-200/70 bg-white/80 p-3.5 shadow-[0_6px_18px_-12px_rgba(6,78,59,0.25)] backdrop-blur-sm"
                        style={anim('cs-up', '.5s', `${0.15 + idx * 0.08}s`)}
                    >
                        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/12">
                            {c.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="font-sans text-[14.5px] font-bold text-stone-800">
                                {c.mr} <span className="text-[11px] font-semibold text-stone-400">({c.en})</span>
                            </p>
                            <p className="mt-0.5 font-sans text-[11.5px] font-medium leading-snug text-stone-500">{c.desc}</p>
                        </div>
                        <span className="flex-shrink-0 pl-1">
                            {c.granted ? (
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                                    <Check size={15} strokeWidth={3} />
                                </span>
                            ) : (
                                <ChevronRight size={18} className="text-stone-300" />
                            )}
                        </span>
                    </div>
                ))}
            </div>

            {/* pointing farmer — grounded in the field, gesturing at the CTA */}
            <div
                data-cs-anim
                className="pointer-events-none absolute -right-3 bottom-[112px] z-[5]"
                style={anim('cs-rise', '.8s', '.3s')}
            >
                {!imgFailed && (
                    <img
                        src="/brand/farmer-point.webp"
                        alt=""
                        aria-hidden="true"
                        onError={() => setImgFailed(true)}
                        className="h-44 w-auto object-contain object-bottom"
                        style={{
                            filter: 'drop-shadow(0 14px 20px rgba(6,78,59,.22))',
                            WebkitMaskImage: 'linear-gradient(180deg,#000 66%,transparent 96%)',
                            maskImage: 'linear-gradient(180deg,#000 66%,transparent 96%)',
                        }}
                    />
                )}
            </div>

            {/* CTA DOCK */}
            <div className="relative z-20 mt-auto w-full">
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-[#F5FCF8] via-[#F5FCF8]/80 to-transparent" />
                <div data-cs-anim className="relative mx-auto w-full max-w-[440px] px-6 pb-6 pt-2" style={anim('cs-up', '.5s', '.5s')}>
                    <button
                        type="button"
                        onClick={requestAllPermissions}
                        className="flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[16px] font-sans text-[16px] font-black text-white shadow-[0_16px_34px_-10px_rgba(4,120,87,0.55)] ring-1 ring-white/25 transition-transform active:scale-[0.98]"
                    >
                        <Shield size={18} /> सर्व परवानग्या द्या
                    </button>
                    <button
                        data-testid="onboarding-skip"
                        onClick={skipOrSave}
                        className="mt-2 w-full py-2 font-sans text-[13px] font-bold text-stone-400 transition-colors hover:text-stone-600"
                    >
                        नंतर देईन
                    </button>
                    <p className="mt-1 flex items-center justify-center gap-1.5 text-center font-sans text-[10.5px] font-semibold leading-normal text-stone-400">
                        <Lock size={10} /> तुमची माहिती सुरक्षित आहे — फक्त गरजेपुरतीच वापरतो.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default OnboardingPermissionsPage;
