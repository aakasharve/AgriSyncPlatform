/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SavedScreenBack — the way out of the post-save surface.
 *
 * WHY (founder, 2026-08-14, verbatim: "there is no going back screen after this
 * screen"): once a log was saved, `renderLogView` swapped the whole log view for
 * the `saved-to-ledger` card. That card is tall — character, understanding,
 * what-you-did, question, streak, task-close — and its only exits were three
 * text buttons at the very bottom. A farmer who did not want to read to the
 * bottom had no way out, and Android's hardware back button left the app
 * entirely, because this SPA never puts anything on the browser history stack.
 *
 * WHAT "back" MEANS HERE: the log-entry view. That is where he came from, and it
 * is the app's home. It is safe: the log is already committed to `history` (it
 * is rendered in the activity feed the moment we return), and `handleReset` —
 * which is `handleResetVoice` — only clears DRAFT state (draft log, provenance,
 * recording segment, live caption, error) and sets `status` back to `idle`. It
 * deletes nothing and re-triggers no parse. So back cannot orphan the saved log.
 *
 * It is therefore the same destination as the bottom "आणखी नोंद करा" button —
 * deliberately. Those two controls carry different INTENTS (leave / keep going)
 * and sit where each intent looks for a control; that they land on the same
 * screen is a property of the app having one home, not duplication to remove.
 *
 * TWO AFFORDANCES, because Android users reach for both:
 *   1. a sticky icon-led control pinned to the top-left of the scroll area, so
 *      it stays reachable however far down the card the farmer has scrolled;
 *   2. the hardware back button, via one history sentinel pushed on mount.
 *
 * The sentinel push is guarded on `history.state` so React StrictMode's
 * development mount→unmount→mount cannot stack two entries, and the cleanup
 * deliberately does NOT call `history.back()` (under StrictMode that queued pop
 * lands on the remounted listener and fires a phantom "back" the farmer never
 * asked for). The residual cost is that leaving via one of the BOTTOM buttons
 * leaves one inert history entry, so exiting the app then takes one extra back
 * press. That is the safe direction to be wrong in.
 *
 * Nothing here animates, so there is nothing for prefers-reduced-motion to
 * suppress; the only transition is a colour change on press.
 */
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '../../../../i18n/LanguageContext';

/** Marks the one history entry this screen owns. */
const BACK_TRAP = 'agrisyncSavedBackTrap';

// Font rule (CHARTER): Marathi body text -> Noto Sans Devanagari.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";

export interface SavedScreenBackProps {
    /** Leave the post-save surface. Wired to `handleReset` in mainView. */
    onBack: () => void;
}

function hasBackTrap(): boolean {
    const state = window.history.state as Record<string, unknown> | null;
    return Boolean(state && state[BACK_TRAP]);
}

export function SavedScreenBack({ onBack }: SavedScreenBackProps): React.ReactElement {
    const { t } = useLanguage();

    // `handleReset` is a fresh function object on every AppRouter render, so it
    // must NOT be an effect dependency — the effect would re-run (and re-push)
    // on every render. The ref keeps the listener pointed at the latest one.
    const onBackRef = React.useRef(onBack);
    onBackRef.current = onBack;

    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        if (!hasBackTrap()) {
            window.history.pushState({ [BACK_TRAP]: true }, '');
        }
        const onPop = () => { onBackRef.current(); };
        window.addEventListener('popstate', onPop);
        return () => { window.removeEventListener('popstate', onPop); };
    }, []);

    const handleClick = () => {
        // Leave first, so the control can never feel dead while we wait for the
        // asynchronous pop. Unmounting removes the listener, so the pop below
        // cannot fire onBack a second time — it only reclaims our own entry.
        onBack();
        if (typeof window !== 'undefined' && hasBackTrap()) {
            window.history.back();
        }
    };

    return (
        // Opaque, not translucent: the surface scrolls UNDER this bar, and a
        // semi-transparent strip leaves a ghost of Devanagari text bleeding
        // through it — the last thing a farmer who reads slowly needs. The
        // colour is the body's own bg-surface-100, so at rest the bar is
        // invisible and only the hairline separates chrome from content.
        <div
            data-testid="saved-back-bar"
            className="sticky top-0 z-30 -mx-4 mb-2 border-b border-stone-200/80 bg-surface-100 px-4 py-2"
        >
            <button
                type="button"
                data-testid="saved-back"
                aria-label={t('common.back')}
                onClick={handleClick}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full pl-1 pr-4 text-stone-700 transition-colors hover:bg-stone-200/70 active:bg-stone-200"
            >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
                    <ArrowLeft size={20} strokeWidth={2.75} aria-hidden="true" />
                </span>
                <span
                    className="text-sm font-bold"
                    style={{ fontFamily: MARATHI_BODY }}
                >
                    {t('common.back')}
                </span>
            </button>
        </div>
    );
}

export default SavedScreenBack;
