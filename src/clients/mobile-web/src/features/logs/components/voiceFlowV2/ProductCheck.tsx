/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B2) — the product check, as the final design draws it (result-v12-final.html
 * `verifyBlock()`, `openCheck()`, `closeCheck()`):
 *   - `CheckRow`: the short "तपासायची" row inside the product flash card ("साथीने नाव बरोबर ऐकलं का?"); once answered it says what was
 *     answered ("तपासलं: बरोबर", "फोटो काढला · तपासणी बाकी", "शेत मालक बघतील") and a tap changes it;
 *   - `CheckCard`: the full-screen card that asks "हे बरोबर आहे का?", shows the name Sathi understood big, its ingredient, and HIS words
 *     small, with three answers.
 *
 * The three answers are the existing answer path, nothing new is sent (P7: an answer is an overlay, never an edit of the record):
 *   "हो, बरोबर" → the kit's `confirmed` answer naming this library product; "नाही — फोटो काढा" → the kit's photo (the existing camera
 *   and attachment flow, an answer `photo`); "शेत मालक बघतील" → no answer at all: the product stays unchecked, i.e. the existing
 *   "मालक तपासतील" state, and the owner finds it in "औषधं तपासा". For someone who checks records that third button is the bottom
 *   card's own "नंतर पाहीन" (the only role wording `ProductCard` already has); the server decides what any answer counts as (D-95).
 *
 * Session memory (this app run only, nothing stored): a check card he closed without answering does not pop by itself again; "शेत
 * मालक बघतील" is remembered for the row.
 */
import React, { useState } from 'react';
import { Camera, ShieldCheck, UserRound, X } from 'lucide-react';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import { PHONE_COLUMN } from '../phoneColumn';
import { ingredientLine, type ProductAnswerKit } from '../voiceResult/ProductCard';
import { answersOf, identityOf, isAnswerable, type ItemAnswers } from '../voiceResult/inputIdentityModel';
import { productName, type ProductItem } from '../voiceResult/productModel';
import { resultCopy } from '../voiceResult/resultCopy';
import { finalResultWords } from './finalResultWords';
import { LineGlyph, SANS } from './savedBits';

const SERIF = "'Noto Serif Devanagari', serif";

export type CheckState = 'yes' | 'photo' | 'no' | 'owner';

const DISMISSED = new Set<string>();
const OWNER = new Set<string>();
export const checkKeyOf = (logId: string, itemId: string): string => `${logId}:${itemId}`;
export const wasCheckDismissed = (key: string): boolean => DISMISSED.has(key);
/** Test seam: forget this session's dismissals and "शेत मालक बघतील" marks. */
export const resetCheckSessionForTests = (): void => { DISMISSED.clear(); OWNER.clear(); };

/** What the record says was answered about this product (the check first, else the speaker's own), else his "owner" mark this session. */
export function checkStateOf(answers: ItemAnswers, key: string): CheckState | null {
    const a = answers.check ?? answers.speaker;
    if (a) return a.verdict === 'confirmed' ? 'yes' : a.verdict === 'photo' ? 'photo' : 'no';
    return OWNER.has(key) ? 'owner' : null;
}

/** May this product be checked on the card at all: a library product with a place in the record the server can read. */
export const isCheckable = (item: ProductItem, logId: string, kit: ProductAnswerKit): boolean =>
    isAnswerable(item) && identityOf(item, answersOf(kit.logById.get(logId), item.ref)).state === 'found';

const ROW_TONE: Record<CheckState | 'open', string> = {
    open: 'border-[#F3D27A] bg-[#FFFBEB] motion-safe:animate-plr-glow',
    yes: 'border-[#86EFAC] bg-[#F0FDF4]',
    photo: 'border-[#7DD3FC] bg-[#F0F9FF]',
    no: 'border-[#D6D3D1] bg-[#FAFAF9]',
    owner: 'border-[#D6D3D1] bg-[#FAFAF9]',
};

export const CheckRow = React.forwardRef<HTMLButtonElement, { state: CheckState | null; onOpen: () => void; testId: string }>(({ state, onOpen, testId }, ref) => {
    const F = finalResultWords(useOptionalLanguage()?.language).flash;
    const title = state === 'yes' ? F.checkedYes : state === 'photo' ? F.checkedPhoto : state === 'no' ? F.checkedNo : state === 'owner' ? F.checkOwner : F.checkRow;
    const Icon = state === 'photo' ? Camera : state === 'owner' ? UserRound : ShieldCheck;
    return (
        <button ref={ref} type="button" onClick={onOpen} data-testid={testId} data-state={state ?? 'open'}
            className={`flex min-h-[62px] w-full items-center gap-2.5 rounded-2xl border-2 px-3 py-2 text-left text-[#1C1917] ${ROW_TONE[state ?? 'open']}`}>
            <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[11px] bg-[#FEF3C7] text-[#92400E]"><Icon size={22} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
                <b className="block text-[18px] font-extrabold leading-[1.25]" data-testid={`${testId}-title`}>{title}</b>
                <small className="block text-[13.5px] font-bold text-[#57534E]">{state ? F.checkChange : F.checkRowSub}</small>
            </span>
            <span className="text-[22px] text-[#A8A29E]" aria-hidden="true">›</span>
        </button>
    );
});
CheckRow.displayName = 'CheckRow';

export interface CheckCardProps {
    item: ProductItem;
    logId: string;
    kit: ProductAnswerKit;
    /** His own words for this product (a stretch of his transcript), shown small under the name. */
    heard: readonly string[];
    /** It answered (or he said the owner will check): the card goes back into its row. */
    onDone: (state: CheckState) => void;
    /** He closed it without answering: it does not pop by itself again this session. */
    onDismiss: () => void;
}

export const CheckCard: React.FC<CheckCardProps> = ({ item, logId, kit, heard, onDone, onDismiss }) => {
    const language = useOptionalLanguage()?.language;
    const F = finalResultWords(language).flash;
    const copy = resultCopy(language);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState<null | 'answer' | 'photo'>(null);
    const key = checkKeyOf(logId, item.id);
    const answers = answersOf(kit.logById.get(logId), item.ref);
    const identity = identityOf(item, answers);
    const dismiss = () => { if (busy) return; DISMISSED.add(key); onDismiss(); };
    useBackDismiss(true, dismiss);
    if (identity.state !== 'found') return null;
    const product = identity.product;
    const name = productName(item, language) || (item.matchName ?? '');
    const waiting = (verdict: 'confirmed' | 'photo'): boolean => [answers.speaker, answers.check].some(a => a?.pending === true && a.verdict === verdict);
    const run = async (kind: 'answer' | 'photo', state: CheckState, go: () => Promise<void>) => {
        if (busy) return;
        setBusy(true);
        setFailed(null);
        try {
            await go();
            OWNER.delete(key);
            hapticFeedback.success();
            onDone(state);
        } catch {
            hapticFeedback.error();
            setFailed(kind);
            setBusy(false);
        }
    };
    const owner = () => {
        if (busy) return;
        if (kit.canCheck) { dismiss(); return; } // the checker's "नंतर पाहीन": not answered, nothing kept
        OWNER.add(key);
        hapticFeedback.selection();
        onDone('owner');
    };
    const BTN = 'flex min-h-[60px] w-full items-center gap-3 rounded-[18px] border-2 px-4 py-2 text-left text-[19px] font-extrabold disabled:opacity-60';
    return (
        <div className="fixed inset-0 z-[70] flex justify-center" data-testid="vr2-check-card" data-item={item.id} style={{ fontFamily: SANS }}>
            <button type="button" aria-hidden="true" tabIndex={-1} onClick={dismiss} className="absolute inset-0 bg-[rgba(60,40,0,0.45)]" data-testid="vr2-check-backdrop" />
            <div role="dialog" aria-modal="true" aria-labelledby="vr2-check-q"
                className={`relative m-3.5 mt-[calc(0.875rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] flex flex-col gap-3.5 overflow-y-auto rounded-[28px] border-[2.5px] border-[#F3D27A] bg-[#FFFDF6] p-4 pt-5 shadow-[0_24px_50px_rgba(0,0,0,0.35)] motion-safe:animate-plr-pop ${PHONE_COLUMN}`}>
                <div className="flex items-center gap-2.5 text-[17px] font-extrabold text-[#78350F]">
                    <span className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#FEF3C7] text-[#92400E]"><ShieldCheck size={26} aria-hidden="true" /></span>
                    <span className="flex-1">{F.checkRow}</span>
                    <button type="button" onClick={dismiss} aria-label={F.close} data-testid="vr2-check-close"
                        className="grid h-9 w-9 place-items-center rounded-full border-[1.5px] border-[#E5E7E1] bg-white text-[#44403C]"><X size={18} aria-hidden="true" /></button>
                </div>
                <b id="vr2-check-q" className="text-[32px] font-bold leading-[1.25] text-[#1C1917]" style={{ fontFamily: SERIF }}>{F.checkQuestion}</b>
                <div className="flex flex-col gap-0.5 rounded-[18px] border-2 border-[#FDE68A] bg-white px-3.5 py-3">
                    <small className="text-[13px] font-bold text-[#78716C]">{F.checkHeard}</small>
                    <b className="text-[30px] font-bold leading-[1.2]" style={{ fontFamily: SERIF }} data-testid="vr2-check-name">{name}</b>
                    {ingredientLine(identity, language) && <span className="text-[16px] font-extrabold text-[#1D4ED8]" data-testid="vr2-check-ingredient">{ingredientLine(identity, language)}</span>}
                    {heard.length > 0 && <em className="mt-1 text-[14.5px] font-semibold not-italic text-[#57534E]" data-testid="vr2-check-heard">“{heard.join(' … ')}”</em>}
                </div>
                <div className="mt-auto flex flex-col gap-2.5">
                    <button type="button" disabled={busy || waiting('confirmed')} data-testid="vr2-check-yes"
                        onClick={() => void run('answer', 'yes', () => kit.onAnswer({ logId, item, verdict: 'confirmed', catalogProductId: product.id }))}
                        className={`${BTN} border-[#047857] bg-[#047857] text-white`}>
                        <LineGlyph name="tick" size={24} className="flex-none" />{F.checkYes}
                    </button>
                    <button type="button" disabled={busy} data-testid="vr2-check-photo"
                        onClick={() => void run('photo', 'photo', () => kit.onPhoto({ logId, item }))}
                        className={`${BTN} border-[#E5E7E1] bg-white text-[#1C1917]`}>
                        <Camera size={24} className="flex-none" aria-hidden="true" />{F.checkPhoto}
                    </button>
                    <button type="button" disabled={busy} data-testid="vr2-check-owner" onClick={owner}
                        className={`${BTN} border-dashed border-[#E5E7E1] bg-white text-[#44403C]`}>
                        <UserRound size={24} className="flex-none" aria-hidden="true" />{kit.canCheck ? copy.closeChecker : F.checkOwner}
                    </button>
                </div>
                {failed && (
                    <p className="m-0 text-[13.5px] font-bold text-amber-800" role="status" data-testid="vr2-check-failed">
                        {failed === 'photo' ? copy.photoFailed : copy.answerFailed}
                    </p>
                )}
            </div>
        </div>
    );
};
