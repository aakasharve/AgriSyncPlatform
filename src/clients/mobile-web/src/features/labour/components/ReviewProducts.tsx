/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2b; IT3 Task 3a; founders D-92, D-95; preview
 * DFES-owner-check-scenario, phone 3) - the "औषधं" block of a review card: one big coloured row per product (the result screen's
 * Option 3 rows, `ProductRow`), and the same bottom card (`ProductCard`) one tap opens, with हो / नाही / फोटो.
 *
 *   - Drawn only when the server sent the record's products (it sends them only to a reader who may hear the record's words); a
 *     record that names no product draws nothing.
 *   - The speaker's own answer is shown as HIS ("सुनीलने सांगितलं: हो"); a check is the checker's. The phone sends no "is check":
 *     the server decides from the sender's standing (D-95).
 *   - Checking is optional and NEVER blocks मंजूर or शंका (P9): this block has no gate and no button the card waits on.
 *   - An answer is queued as an overlay (`assert_input_identity`) and changes nothing in the record (P7).
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DailyLog } from '../../../domain/types/log.types';
import { CATALOG_VERSION } from '../../../domain/inputs/inputCatalog';
import type { ReviewItem } from '../labour.types';
import type { Language } from '../../../i18n/language';
import { getSessionUserId } from '../../../infrastructure/storage/AuthTokenStore';
import { AssertInputIdentityCommand } from '../../../application/usecases/sync/AssertInputIdentityCommand';
import { captureAttachment } from '../../../application/use-cases/CaptureAttachment';
import type { ApprovalWords } from '../../approval/approvalWords';
import { ProductRow } from '../../logs/components/voiceResult/ProductRows';
import { ProductCard, type ProductAnswerKit } from '../../logs/components/voiceResult/ProductCard';
import type { ProductItem } from '../../logs/components/voiceResult/productModel';
import { resultStr } from '../../logs/components/voiceResult/resultStrings';
import { answerHolderOf, mergedAnswers, reviewProductItems, uncheckedOf } from './reviewProductsModel';

export interface ReviewProductsProps {
    item: ReviewItem;
    words: ApprovalWords;
    language: Language;
    /** This phone's own records (live): this record's doses as he said them, and the answers made here and not sent yet. */
    history?: readonly DailyLog[];
    farmId?: string;
    /** He holds the confirm-records authority (the sheet's own `mayApprove`). */
    canCheck: boolean;
    /** The phone holder's own name (his profile's): his check reads by it, never "तुम्ही". */
    ownName?: string;
}

export const ReviewProducts: React.FC<ReviewProductsProps> = ({ item, words, language, history, farmId, canCheck, ownName }) => {
    const [open, setOpen] = useState<ProductItem | null>(null);
    const products = item.products;
    const localLog = useMemo(() => history?.find(l => l.id === item.id), [history, item.id]);
    const viewerUserId = getSessionUserId();
    const RS = resultStr(language);

    const model = useMemo(() => {
        if (!products || products.length === 0) return null;
        const answers = mergedAnswers(products, localLog, { viewerUserId, canCheck });
        const holder = answerHolderOf(item, localLog, answers);
        const rows = reviewProductItems(products, localLog);
        // The speaker's own answer is the record maker's: his name is the card's name. Whoever else answered is named only when
        // this phone knows him (the phone holder); otherwise the unknown word - never a guess, never "तुम्ही".
        const speakerId = products.find(p => p.speakerAnswer)?.speakerAnswer?.assertedByUserId ?? null;
        return { holder, rows, speakerId, unchecked: uncheckedOf(rows, holder) };
    }, [products, localLog, item, viewerUserId, canCheck]);

    if (!model || !products) return null;

    const farm = localLog?.meta?.farmId ?? farmId ?? null;
    const enqueue = async (item0: ProductItem, rest: { verdict: 'confirmed' | 'rejected' | 'photo'; catalogProductId?: string; attachmentId?: string }) => {
        if (!farm || !item0.ref) throw new Error('ReviewProducts: this product cannot be answered about yet.');
        await AssertInputIdentityCommand.enqueue({
            farmId: farm, dailyLogId: item.id, inputEventId: item0.ref.eventId, mixIndex: item0.ref.mixIndex, catalogVersion: CATALOG_VERSION, ...rest,
        });
    };
    const kit: ProductAnswerKit = {
        logById: new Map([[item.id, model.holder]]),
        canCheck,
        canSeeMoney: false,
        nameOfUser: userId => {
            if (userId && userId === viewerUserId && ownName) return ownName;
            if (userId && userId === model.speakerId && item.who) return item.who;
            return RS.unknownPerson;
        },
        cropNamesOf: () => (localLog?.context?.selection ?? []).map(s => s.cropName).filter((n): n is string => !!n),
        onAnswer: ({ item: it, verdict, catalogProductId }) => enqueue(it, { verdict, ...(catalogProductId ? { catalogProductId } : {}) }),
        onPhoto: async ({ item: it }) => {
            if (!farm) throw new Error('ReviewProducts: no farm for this photo.');
            const photo = await captureAttachment({ source: 'camera', farmId: farm, linkedEntityId: item.id, linkedEntityType: 'DailyLog' });
            await enqueue(it, { verdict: 'photo', attachmentId: photo.id });
        },
    };

    return (
        <div className="mt-3" data-testid={`review-products-${item.id}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[15.5px] font-extrabold text-violet-900" data-testid={`review-products-title-${item.id}`}>{words.productsTitle}</span>
                <span className={`text-[13px] font-extrabold ${model.unchecked === 0 ? 'text-emerald-700' : 'text-amber-800'}`} data-testid={`review-products-count-${item.id}`}>
                    {model.unchecked === 0 ? words.productsAllChecked : words.productsToCheck(model.unchecked)}
                </span>
            </div>
            <div className="mt-1.5 space-y-2">
                {model.rows.map(row => (
                    <ProductRow key={row.id} item={row} logId={item.id} kit={kit} onOpen={it => setOpen(it)} />
                ))}
            </div>
            {/* The card is drawn over the whole screen, above this sheet (z-[60]): outside the sheet's own transformed box. */}
            {open && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[70]" data-testid={`review-product-card-host-${item.id}`}>
                    <ProductCard item={open} logId={item.id} kit={kit} onClose={() => setOpen(null)} />
                </div>,
                document.body,
            )}
        </div>
    );
};

export default ReviewProducts;
