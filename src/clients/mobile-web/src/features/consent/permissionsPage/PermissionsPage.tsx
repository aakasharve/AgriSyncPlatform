// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A; R1 item 02)
//
// THE ONE LONG PERMISSIONS AND PRIVACY PAGE, opened when he taps "OTP पाठवा" (and the password sign-in, and the QR join
// page) - BEFORE his number leaves the phone. Founder V6c-A:
//   - one plain text, no section titles, in his language (मराठी / English at the top);
//   - the two optional switches ON when the page opens, and the words say so;
//   - a vertical bar on the right fills with a glow as he scrolls, a small sprout moving down it - no percentage;
//   - a grey button stays at the bottom ("शेवटपर्यंत वाचा": a tap scrolls on) and turns green, "मी वाचलं, पुढे चला",
//     only once the end has been on screen. Reaching the end records nothing; only his tap does.
//   - "नको": nothing is sent or saved; back to the number.
// Every line comes from `permissionsPageWords` - the same words `canonicalPermissionsPageText` hashes.
//
// Focus is left alone on purpose (a hidden input that took focus once broke the real sign-in): nothing here grabs focus
// or listens to focus events. LEGAL CHECK NEEDED before release.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ArrowLeft, ChevronDown, ChevronRight, Sprout } from 'lucide-react';
import LegalDocumentView, { type LegalDocument } from '../../legal/LegalDocumentView';
import type { NoticeLanguage } from '../gate/consentNotice';
import { permissionsPageWords, permissionsParagraph } from './permissionsPageWords';
import { useReadToEnd } from './useReadToEnd';

export interface SwitchChoices {
    voicePlayback: boolean;
    improvement: boolean;
}

export interface PermissionsPageProps {
    language: NoticeLanguage;
    onLanguage: (language: NoticeLanguage) => void;
    /** True while the acceptance is being written: the button is held. */
    recording: boolean;
    onAccept: (choices: SwitchChoices) => void;
    onDecline: () => void;
}

const P = 'm-0 mt-3 text-[15.5px] font-medium leading-[1.7] text-stone-800';

/** Android hardware Back on this page = "नको" (the number screens have no other Back handler before sign-in). */
function useHardwareBack(onBack: () => void): void {
    const latest = useRef(onBack);
    latest.current = onBack;
    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return undefined;
        let cancelled = false;
        let remove: (() => Promise<void>) | undefined;
        void App.addListener('backButton', () => latest.current()).then((handle) => {
            if (cancelled) void handle.remove();
            else remove = () => handle.remove();
        });
        return () => { cancelled = true; void remove?.(); };
    }, []);
}

const PermissionsPage: React.FC<PermissionsPageProps> = ({ language, onLanguage, recording, onAccept, onDecline }) => {
    const w = permissionsPageWords(language);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [view, setView] = useState<'page' | LegalDocument>('page');
    const [choices, setChoices] = useState<SwitchChoices>({ voicePlayback: true, improvement: true });
    const { progress, reachedEnd } = useReadToEnd(scrollRef, `${language}:${view}`);
    useHardwareBack(() => (view === 'page' ? onDecline() : setView('page')));

    const goOn = () => {
        if (!reachedEnd) {
            const el = scrollRef.current;
            if (!el) return;
            const by = Math.max(240, el.clientHeight * 0.8);
            if (typeof el.scrollBy === 'function') el.scrollBy({ top: by, behavior: 'smooth' });
            else el.scrollTop += by;
            return;
        }
        if (!recording) onAccept(choices);
    };

    const flip = (id: keyof SwitchChoices) => setChoices((c) => ({ ...c, [id]: !c[id] }));

    return createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="permissions-page-title" data-testid="permissions-page"
            lang={language} className="fixed inset-0 z-[120] flex flex-col bg-[#FAFAF9] font-sans">
            <div ref={scrollRef} data-testid="permissions-page-scroll"
                className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pl-4 pr-10 pt-[calc(0.75rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))]">
                <div className="mx-auto max-w-[560px] pb-6">
                    <div className="flex justify-end">
                        <div role="group" aria-label={w.languageLabel} className="flex gap-1 rounded-full bg-stone-200/70 p-1">
                            {(['mr', 'en'] as const).map((code) => (
                                <button key={code} type="button" onClick={() => onLanguage(code)} aria-pressed={language === code}
                                    data-testid={`permissions-page-lang-${code}`}
                                    className={`min-h-[36px] rounded-full px-3 text-[13px] font-extrabold ${language === code ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-600'}`}>
                                    {code === 'mr' ? 'मराठी' : 'English'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {view !== 'page' ? (
                        <>
                            <button type="button" onClick={() => setView('page')}
                                className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-[15px] font-bold text-emerald-800">
                                <ArrowLeft size={18} aria-hidden="true" />{w.title}
                            </button>
                            <LegalDocumentView doc={view} language={language} />
                        </>
                    ) : (
                        <div data-testid="permissions-page-text">
                            <h2 id="permissions-page-title" className="m-0 mt-2 text-[23px] font-black leading-tight text-stone-900">{w.title}</h2>
                            <p className={P}>{w.intro} {w.readAll}</p>
                            <p className={`${P} text-[13.5px] text-stone-600`}>{w.brandLine}</p>
                            <p className={P}>{permissionsParagraph(w)} {w.permissionsOff}</p>
                            {w.cards.map((line) => <p key={line} className={P}>{line}</p>)}
                            <p className={P}>{w.whoSees.join(' ')}</p>
                            <p className={P}>{w.processors}</p>
                            <p className={P}>{w.willNotDo.join(' ')}</p>
                            <p className={P}>{w.rightsWhere} {w.rights.join(' ')}</p>
                            <p className={P}>{w.withdrawal} {w.boardComplaint}</p>
                            <p className={`${P} font-bold`} data-testid="permissions-page-switches-on">{w.switchesOn} {w.earlierChoiceStays}</p>
                            {w.switches.map((s) => (
                                <div key={s.id} className="mt-2 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                                    <div className="flex items-center gap-3">
                                        <span id={`permissions-switch-${s.id}-title`} className="flex-1 text-[15px] font-extrabold leading-snug text-stone-900">{s.title}</span>
                                        <button type="button" role="switch" aria-checked={choices[s.id]} aria-labelledby={`permissions-switch-${s.id}-title`}
                                            data-testid={`permissions-switch-${s.id}`} onClick={() => flip(s.id)} disabled={recording}
                                            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${choices[s.id] ? 'bg-emerald-600' : 'bg-stone-300'}`}>
                                            <span aria-hidden="true" className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-[left] ${choices[s.id] ? 'left-7' : 'left-1'}`} />
                                        </button>
                                    </div>
                                    <p className="m-0 mt-1 text-[13.5px] leading-relaxed text-stone-700">{s.body}</p>
                                </div>
                            ))}
                            <p className={P}>{w.notNow}</p>
                            <p className={P}>{w.entityLine}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <button type="button" data-testid="permissions-page-terms" onClick={() => setView('terms')}
                                    className="min-h-[44px] rounded-full bg-white px-4 text-[14px] font-bold text-emerald-800 ring-1 ring-emerald-300">{w.termsLink}</button>
                                <button type="button" data-testid="permissions-page-privacy" onClick={() => setView('privacy')}
                                    className="min-h-[44px] rounded-full bg-white px-4 text-[14px] font-bold text-emerald-800 ring-1 ring-emerald-300">{w.privacyLink}</button>
                            </div>
                            <p className={P}>{w.acceptanceMeaning}</p>
                            <div className="mt-5 rounded-[20px] bg-emerald-50 p-4 ring-1 ring-emerald-200" data-testid="permissions-page-statement">
                                <p className="m-0 text-[16px] font-extrabold leading-normal text-emerald-900">{w.statement}</p>
                                <p className="m-0 mt-1.5 text-[16px] font-extrabold leading-normal text-emerald-900">{w.age}</p>
                            </div>
                            <p className="m-0 mt-3 text-[13px] text-stone-600" data-testid="permissions-page-end">{w.noLine}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* The reading bar: fills as he scrolls; the sprout rides its tip. No number anywhere. */}
            <div aria-hidden="true" data-testid="permissions-page-bar" data-reached={reachedEnd ? 'yes' : 'no'}
                className="pointer-events-none absolute bottom-[140px] right-[13px] top-[64px] w-1.5 rounded-full bg-stone-200">
                <div className={`absolute inset-x-0 top-0 rounded-full bg-gradient-to-b from-emerald-200 via-emerald-500 to-emerald-700 motion-safe:transition-[height] ${reachedEnd ? 'shadow-[0_0_16px_3px_rgba(5,150,105,0.65)]' : 'shadow-[0_0_10px_rgba(16,185,129,0.55)]'}`}
                    style={{ height: `${progress}%` }} />
                <span className={`absolute left-1/2 -ml-[13px] -mt-[13px] grid h-[26px] w-[26px] place-items-center text-emerald-700 drop-shadow-[0_0_6px_rgba(16,185,129,0.8)] motion-safe:transition-[top,transform] ${reachedEnd ? 'scale-125 text-emerald-600' : ''}`}
                    style={{ top: `${progress}%` }}>
                    <Sprout size={22} strokeWidth={2.2} />
                </span>
            </div>

            <footer className="border-t border-stone-200 bg-white/95 px-4 pt-2.5 pb-[calc(0.85rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] shadow-[0_-8px_18px_-10px_rgba(0,0,0,0.2)]">
                <div className="mx-auto max-w-[560px]">
                    <button type="button" data-testid="permissions-page-go" data-ready={reachedEnd ? 'yes' : 'no'} onClick={goOn} disabled={recording}
                        className={`flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full text-[17px] font-black disabled:opacity-70 ${reachedEnd
                            ? 'bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 text-white shadow-[0_12px_28px_-10px_rgba(4,120,87,0.6)]'
                            : 'bg-stone-300 text-stone-800'}`}>
                        {recording ? w.saving : reachedEnd ? w.go : w.readFirst}
                        {!recording && (reachedEnd ? <ChevronRight size={19} aria-hidden="true" /> : <ChevronDown size={19} aria-hidden="true" />)}
                    </button>
                    <button type="button" data-testid="permissions-page-no" onClick={onDecline} disabled={recording}
                        className="mt-1.5 block min-h-[40px] w-full text-center text-[15px] font-extrabold text-stone-600">
                        {w.no}
                    </button>
                </div>
            </footer>
        </div>,
        document.body,
    );
};

export default PermissionsPage;
