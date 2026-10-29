/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — every word the farmer sees here is now Marathi
 * (it was English: "New Expense", "Take Photo", "Convert to Expense"…).
 *
 * spec: pre-launch-repair L2a (R-3, R-6, R-8, R-9; D-12 / D-18 / D-19 / D-41):
 *   - the farm: the farm of the page's plot, else the farm the app is working on (a remembered farm counts
 *     only if this phone holds it — `resolveKnownFarmId`) — never "the first farm of the last download".
 *     With no farm known nothing is read or sent and the sheet asks ONCE which of the farmer's farms the
 *     bill is for (the header's switcher is out of reach under this sheet); choosing one carries on exactly
 *     like a known farm, and so does the app learning its farm meanwhile. Until then the photo is only on
 *     this open sheet — the words never claim it is kept — so closing asks first, and "पुन्हा काढा" drops
 *     it. With no farm at all the sheet says so, promising nothing. The photo, its reading and the money
 *     all use that ONE farm.
 *   - no invented values: no "paid"/"cash" unless the bill said so, no ₹0 rate, no ₹0 line; an amount
 *     nobody gave shows "—"; a total-only bill is saved as one entry for its total (`billMoneyLines`).
 *   - the photo is queued once (the original file, untouched) and its upload state is shown in the words
 *     the app already has (`AttachmentStatusBadge`); the money entry names the photo's id, never the photo.
 *   - the "split this bill across plots" step is gone: it could never land (the split named the bill, not
 *     a server money entry — N2). A whole-farm bill stays recorded as whole-farm.
 */
import React, { useEffect, useState, useRef } from 'react';
import { Camera, X, Check, Loader2, AlertTriangle } from 'lucide-react';
import { extractReceiptWithSession, VerificationStatus } from '../receipt/receiptExtractionClient';
import { ReceiptExtractionResponse, ProcurementExpense, ExpenseScope, CropProfile } from '../../../types';
import { ScopeSelectorRadio } from './ScopeSelectorRadio';
import { procurementRepository } from '../../../services/procurementRepository';
import { v4 as uuidv4 } from 'uuid';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { financeCommandService } from '../../finance/financeCommandService';
import { captureAttachment } from '../../../application/use-cases/CaptureAttachment';
import { resolveFarmIdFromSyncState, resolveKnownFarmId } from '../../../infrastructure/sync/SyncContext';
import { attachmentUploadWorker } from '../../../infrastructure/sync/AttachmentUploadWorker';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import AttachmentStatusBadge from '../../attachments/components/AttachmentStatusBadge';
import { useMoneyEvidence } from '../../finance/moneyEntryState';
import { billMoneyLines, billPaymentMode, isGivenAmount } from '../billMoney';
import { SANS } from '../../../shared/components/ui/placeUi';

/** Shown while a photo taken offline waits to be read (the reader's own message is English). */
const QUEUED_OFFLINE_MR = 'बिलाचा फोटो फोनवर ठेवला आहे. इंटरनेट आल्यावर वाचला जाईल.';
// PROPOSED (Marathi) — no farm known: asked once which farm; until then the photo is sent nowhere (and the
// words do not claim it is kept — it lives only on this open sheet).
export const FARM_UNKNOWN_MR = 'हे बिल कोणत्या शेताचं? शेत निवडा. तोपर्यंत फोटो कुठेही पाठवलेला नाही.';
// PROPOSED (Marathi) — the app knows no farm at all: said plainly, with no promise that the photo is kept.
export const NO_FARM_AT_ALL_MR = 'या फोनवर अजून एकही शेत नाही. हा फोटो कुठेही ठेवलेला किंवा पाठवलेला नाही.';
// PROPOSED (Marathi) — closing the sheet while a photo still waits for its farm.
export const CLOSE_WAITING_MR = 'फोटो अजून कुठेही पाठवलेला नाही — बंद केलं तर तो राहणार नाही. बंद करायचं?';
// PROPOSED (Marathi)
export const CLOSE_ANYWAY_MR = 'हो, बंद करा';
// PROPOSED (Marathi)
export const KEEP_OPEN_MR = 'नाही, थांबा';
// PROPOSED (Marathi) — the photo could not even be kept on the phone for sending.
export const PHOTO_NOT_KEPT_MR = 'फोटो फोनवर ठेवता आला नाही. पुन्हा काढा.';

const readAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
});

interface Props {
    onClose: () => void;
    onSave: () => void;
    crops: CropProfile[];
    activePlotId?: string; // Pre-fill context if available
}

export const ReceiptCaptureSheet: React.FC<Props> = ({ onClose, onSave, crops, activePlotId }) => {
    // 1. Image State
    const [image, setImage] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);

    // The farm this bill belongs to (photo, reading and money alike), and a photo waiting for one.
    const farmCtx = useOptionalFarmContext();
    const contextFarmId = farmCtx?.currentFarmId ?? null;
    const knownFarms = farmCtx?.farms ?? [];
    const [farmId, setFarmId] = useState<string | null>(null);
    const [waiting, setWaiting] = useState<{ file: File; base64: string } | null>(null);
    const [confirmClose, setConfirmClose] = useState(false);

    // 2. Data State
    const [extraction, setExtraction] = useState<ReceiptExtractionResponse | null>(null);
    const [scope, setScope] = useState<ExpenseScope>('FARM'); // Default to FARM safe
    const [selectedPlotId, setSelectedPlotId] = useState<string>(activePlotId || '');
    const [selectedCropId, setSelectedCropId] = useState<string>('');

    // 3. User Edits (for correction). `null` = no total given — shown empty, never ₹0.
    const [editedTotal, setEditedTotal] = useState<number | null>(null);
    const [editedVendor, setEditedVendor] = useState<string>('');
    const [photo, setPhoto] = useState<{ id: string; status: string } | null>(null);
    const [photoNotKept, setPhotoNotKept] = useState(false);
    const [queuedExtractionMessage, setQueuedExtractionMessage] = useState<string | null>(null);
    const evidence = useMoneyEvidence();
    const photoStatus = photo ? (evidence?.photos.get(photo.id) ?? photo.status) : null;

    // 4. Verification state (two-lane progressive UX)
    const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
    // Suggestions for fields the user has already edited — never auto-overwrite, just hint
    const [suggestedTotal, setSuggestedTotal] = useState<number | null>(null);
    const [suggestedVendor, setSuggestedVendor] = useState<string | null>(null);
    // Whether the user has manually changed each field (guard against auto-overwrite). Read only through the
    // functional setters below (`prev`), hence the `_` names.
    const [_userEditedTotal, setUserEditedTotal] = useState(false);
    const [_userEditedVendor, setUserEditedVendor] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- HANDLERS ---

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setPhoto(null);
        setPhotoNotKept(false);
        setWaiting(null);
        setConfirmClose(false);
        const base64 = await readAsDataUrl(file);
        setImage(base64);

        const farm = (await resolveFarmIdFromSyncState(activePlotId).catch(() => null))
            ?? contextFarmId
            // A remembered farm counts only if this phone holds it — the log path's own check (review m8).
            ?? (await resolveKnownFarmId(SessionStore.getCurrentFarmId()).catch(() => null));
        if (!farm) {
            setWaiting({ file, base64 }); // only on this open sheet; nothing is read or sent to a guessed farm
            return;
        }
        begin(farm, file, base64);
    };

    const begin = (farm: string, file: File, base64: string) => {
        setFarmId(farm);
        setWaiting(null);
        setConfirmClose(false);
        void queuePhoto(farm, file);
        void processImage(base64, farm);
    };

    // A photo waiting for its farm carries on by itself once the app knows the farm.
    useEffect(() => {
        if (waiting && contextFarmId) begin(contextFarmId, waiting.file, waiting.base64);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `begin` is this render's; the trigger is the farm arriving
    }, [waiting, contextFarmId]);

    // A photo still waiting for its farm was sent nowhere: closing asks first (it would be lost).
    const requestClose = () => {
        if (waiting) setConfirmClose(true);
        else onClose();
    };

    // "पुन्हा काढा" discards the photo — a waiting one too, so it can never be queued later (review m4).
    const retake = () => {
        setImage(null);
        setWaiting(null);
        setConfirmClose(false);
    };

    /** The original file, queued once for upload to the bill's farm — never compressed or changed. */
    const queuePhoto = async (farm: string, file: File): Promise<void> => {
        try {
            const queued = await captureAttachment({
                source: 'file',
                farmId: farm,
                linkedEntityId: farm,
                linkedEntityType: 'Farm',
                file,
                fileName: file.name,
                mimeType: file.type
            });

            setPhoto({ id: queued.id, status: queued.status });
            void attachmentUploadWorker.triggerNow();
        } catch (error) {
            console.error('Attachment queue capture failed', error);
            // Not silent: the farmer is told the photo was not kept (the bill itself can still be saved).
            setPhotoNotKept(true);
        }
    };

    const processImage = async (base64: string, farm: string) => {
        setIsExtracting(true);
        setVerificationStatus(null);
        setQueuedExtractionMessage(null);
        setSuggestedTotal(null);
        setSuggestedVendor(null);
        setUserEditedTotal(false);
        setUserEditedVendor(false);

        try {
            const result = await extractReceiptWithSession(
                base64,
                farm,
                (update) => {
                    setVerificationStatus(update.status);

                    if (update.status === 'verified' && update.updated) {
                        const { grandTotal, vendorName } = update.updated;

                        if (isGivenAmount(grandTotal)) {
                            // Auto-apply if user hasn't touched the field; otherwise suggest
                            setUserEditedTotal(prev => {
                                if (!prev) setEditedTotal(grandTotal);
                                else setSuggestedTotal(grandTotal);
                                return prev;
                            });
                        }

                        if (vendorName !== undefined) {
                            setUserEditedVendor(prev => {
                                if (!prev) setEditedVendor(vendorName);
                                else setSuggestedVendor(vendorName);
                                return prev;
                            });
                        }
                    }
                },
            );

            if (result.queued) {
                setExtraction(null);
                setQueuedExtractionMessage(QUEUED_OFFLINE_MR);
                return;
            }

            setExtraction(result);
            setEditedTotal(isGivenAmount(result.grandTotal) ? result.grandTotal : null);
            setEditedVendor(result.vendorName || '');
            if (result.suggestedScope && result.suggestedScope !== 'UNKNOWN') {
                setScope(result.suggestedScope);
            }

            if (result.suggestedCropName) {
                const match = crops.find(c => c.name.toLowerCase().includes(result.suggestedCropName!.toLowerCase()));
                if (match) setSelectedCropId(match.id);
            }

            // Mark that verification is pending (poller has started)
            setVerificationStatus('pending');
        } catch (e) {
            console.error(e);
            alert('बिलाचा फोटो वाचता आला नाही. पुन्हा फोटो काढा.');
        } finally {
            setIsExtracting(false);
        }
    };

    const handleConfirm = () => {
        if (!extraction || !farmId || !isGivenAmount(editedTotal)) return;

        // Construct final object. No payment status: the bill did not state one (R-6).
        const newExpense: ProcurementExpense = {
            id: uuidv4(),
            date: extraction.date || getDateKey(),
            createdAt: new Date().toISOString(),
            scope: scope,
            plotId: scope === 'PLOT' ? selectedPlotId : undefined,
            cropId: (scope === 'CROP' || scope === 'PLOT') ? selectedCropId : undefined,
            vendorName: editedVendor,
            lineItems: extraction.lineItems.map(i => ({ ...i, id: uuidv4(), totalAmount: i.totalAmount, category: i.suggestedCategory })),
            subtotal: extraction.subtotal || editedTotal,
            grandTotal: editedTotal,
            receiptImageUrl: image || undefined, // the list's thumbnail, kept on this phone only
            attachmentIds: photo ? [photo.id] : undefined,
            aiExtracted: true,
            userVerified: true,
            aiRawResponse: JSON.stringify(extraction)
        };

        procurementRepository.saveExpense(newExpense);

        billMoneyLines(newExpense).forEach((line) => {
            financeCommandService.createMoneyEventFromSource({
                type: 'Procurement',
                sourceId: line.sourceId,
                dateTime: new Date(newExpense.date).toISOString(),
                eventType: 'Expense',
                category: line.category,
                farmId,
                plotId: newExpense.plotId,
                cropId: newExpense.cropId,
                amount: line.amount,
                qty: line.qty,
                unit: line.unit,
                unitPrice: line.unitPrice,
                paymentMode: billPaymentMode(newExpense),
                vendorName: newExpense.vendorName?.trim() || undefined,
                createdByUserId: newExpense.operatorId || 'owner',
                // The queued photo's id — never the photo itself (it used to fall back to the whole base64).
                attachments: newExpense.attachmentIds ?? [],
            });
        });

        // A whole-farm bill stays recorded as whole-farm: no split step (R-9).
        onSave();
        onClose();
    };

    // --- RENDER ---

    // The "where does it go" choice names the plot and crop chosen in THIS sheet's dropdowns — the ones the
    // save uses — never the page's pick, which the dropdowns may have moved away from (I8 review B006). It
    // used to say "Selected" / "This Crop".
    const chosenPlotName = crops.flatMap(c => c.plots).find(p => p.id === selectedPlotId)?.name;
    const chosenCropName = crops.find(c => c.id === selectedCropId)?.name;

    return (
        <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in"
            style={{ fontFamily: SANS }} data-testid="receipt-capture-sheet">
            <div className="bg-white w-full max-w-lg h-[90vh] sm:h-auto sm:max-h-[90vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">

                {/* HEAD */}
                <div className="flex-none p-4 border-b border-gray-100 flex items-center justify-between bg-white">
                    <h2 className="text-lg font-black text-gray-800">नवं बिल</h2>
                    <button onClick={requestClose} aria-label="बंद करा" className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={20} /></button>
                </div>

                {/* BODY */}
                <div className="flex-1 overflow-y-auto p-4 bg-gray-50">

                    {confirmClose && (
                        <div role="alertdialog" data-testid="bill-close-confirm" className="mb-4 rounded-lg border border-amber-300 bg-white px-3 py-3 text-sm font-semibold text-stone-800">
                            <p className="m-0">{CLOSE_WAITING_MR}</p>
                            <div className="mt-3 flex gap-2">
                                <button type="button" onClick={() => setConfirmClose(false)} className="flex-1 rounded-lg bg-gray-100 py-2 font-bold text-stone-700">{KEEP_OPEN_MR}</button>
                                <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-amber-600 py-2 font-bold text-white">{CLOSE_ANYWAY_MR}</button>
                            </div>
                        </div>
                    )}

                    {/* 1. IMAGE CAPTURE */}
                    {!image && (
                        <div className="flex flex-col gap-4">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-emerald-600 text-white p-8 rounded-3xl shadow-xl flex flex-col items-center gap-4 active:scale-95 transition-all"
                            >
                                <div className="p-4 bg-white/20 rounded-full"><Camera size={48} /></div>
                                <div className="text-xl font-bold">फोटो काढा</div>
                                <span className="text-emerald-100 text-sm">बिलाचा किंवा पावतीचा</span>
                            </button>
                            <input
                                data-testid="attachment-input"
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                            />
                            <div className="text-center text-stone-500 text-sm font-medium p-4">
                                फोटोतून वस्तू आणि किंमती आपोआप वाचायचा प्रयत्न होईल. नंतर तुम्ही तपासून बदलू शकता.
                            </div>
                        </div>
                    )}

                    {/* 2. PREVIEW & PROCESSING */}
                    {image && (
                        <div className="flex flex-col gap-6">
                            {waiting && (
                                <div data-testid="bill-farm-unknown" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                    {knownFarms.length > 0 ? (
                                        <>
                                            <p className="m-0">{FARM_UNKNOWN_MR}</p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {knownFarms.map(f => (
                                                    <button key={f.farmId} type="button" data-testid={`bill-farm-choice-${f.farmId}`}
                                                        onClick={() => begin(f.farmId, waiting.file, waiting.base64)}
                                                        className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-bold text-stone-800">
                                                        {f.name}
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    ) : NO_FARM_AT_ALL_MR}
                                </div>
                            )}
                            {photoNotKept && (
                                <div data-testid="bill-photo-not-kept" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                    {PHOTO_NOT_KEPT_MR}
                                </div>
                            )}
                            {photo && photoStatus && (
                                <div data-testid="bill-photo-state" className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700">
                                    बिलाचा फोटो <AttachmentStatusBadge status={photoStatus} />
                                </div>
                            )}
                            {queuedExtractionMessage && (
                                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                                    {queuedExtractionMessage}
                                </div>
                            )}

                            {/* Image Thumbnail */}
                            <div className="relative w-full h-48 bg-black rounded-xl overflow-hidden shadow-sm shrink-0">
                                <img src={image} alt="बिलाचा फोटो" className="w-full h-full object-contain opacity-80" />
                                <button onClick={retake} className="absolute bottom-2 right-2 px-3 py-1 bg-black/60 text-white text-xs rounded-lg font-bold backdrop-blur-md border border-white/20">
                                    पुन्हा काढा
                                </button>
                            </div>

                            {/* LOADING STATE */}
                            {isExtracting && (
                                <div className="py-12 flex flex-col items-center justify-center text-emerald-600">
                                    <Loader2 size={40} className="animate-spin mb-4" />
                                    <p className="font-bold">बिल वाचत आहे…</p>
                                    <p className="text-xs opacity-70">वस्तू आणि किंमती शोधत आहे</p>
                                </div>
                            )}

                            {/* RESULT & EDIT FORM */}
                            {!isExtracting && extraction && (
                                <div className="space-y-6 animate-in slide-in-from-bottom-8">

                                    {/* Confidence Banner */}
                                    {extraction.confidence < 80 && (
                                        <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg flex items-start gap-3">
                                            <AlertTriangle className="text-amber-500 shrink-0" size={18} />
                                            <div>
                                                <p className="text-amber-800 text-xs font-bold">एकदा तपासा</p>
                                                <p className="text-amber-700 text-[12px]">फोटो नीट वाचता आला नाही. रक्कम बरोबर आहे का ते पाहा.</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Verification Status Badge */}
                                    {verificationStatus === 'pending' || verificationStatus === 'verifying' ? (
                                        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-blue-700 text-xs font-semibold">
                                            <Loader2 size={13} className="animate-spin shrink-0" />
                                            बिल पुन्हा बारकाईने वाचत आहे…
                                        </div>
                                    ) : verificationStatus === 'verified' ? (
                                        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700 text-xs font-semibold">
                                            <Check size={13} className="shrink-0" />
                                            बिल बारकाईने वाचून झालं
                                        </div>
                                    ) : verificationStatus === 'needs_review' ? (
                                        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 text-xs font-semibold">
                                            <AlertTriangle size={13} className="shrink-0" />
                                            दुसऱ्या वाचनात फरक दिसला — रक्कम पुन्हा पाहा
                                        </div>
                                    ) : null}

                                    {/* Extracted Fields */}
                                    <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-4 shadow-sm">
                                        <div>
                                            <label className="text-[13px] font-bold text-stone-600 block mb-1">दुकान</label>
                                            <input
                                                value={editedVendor}
                                                onChange={(e) => { setEditedVendor(e.target.value); setUserEditedVendor(true); }}
                                                className="w-full text-base font-bold text-gray-900 border-b border-gray-200 outline-none focus:border-emerald-500 py-1"
                                                placeholder="दुकानाचं नाव"
                                            />
                                            {suggestedVendor && suggestedVendor !== editedVendor && (
                                                <p className="text-[12px] text-amber-700 mt-1">
                                                    दुसऱ्या वाचनात: <button className="font-bold underline" onClick={() => { setEditedVendor(suggestedVendor); setSuggestedVendor(null); }}>{suggestedVendor}</button>
                                                </p>
                                            )}
                                        </div>

                                        {/* Items List (Simplified for prototype) */}
                                        <div className="space-y-2">
                                            <label className="text-[13px] font-bold text-stone-600 block">बिलातल्या वस्तू</label>
                                            {extraction.lineItems.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center text-sm py-1 border-b border-dotted border-gray-100 last:border-0">
                                                    <span className="text-gray-700 font-medium">{item.name}{item.quantity !== undefined && <span className="text-gray-400 text-xs"> ({item.quantity} {item.unit ?? ''})</span>}</span>
                                                    {/* An amount nobody read is "—", never ₹0. */}
                                                    <span className="font-bold text-gray-900" data-testid={`bill-line-amount-${idx}`}>{isGivenAmount(item.totalAmount) ? `₹${item.totalAmount}` : '—'}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div>
                                            <label className="text-[13px] font-bold text-stone-600 block mb-1">एकूण रक्कम</label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xl font-black text-gray-900">₹</span>
                                                <input
                                                    type="number"
                                                    value={editedTotal ?? ''}
                                                    placeholder="—"
                                                    data-testid="bill-total"
                                                    onChange={(e) => { setEditedTotal(e.target.value === '' ? null : Number(e.target.value)); setUserEditedTotal(true); }}
                                                    className="w-full text-2xl font-black text-gray-900 border-b border-gray-200 outline-none focus:border-emerald-500 py-1"
                                                />
                                            </div>
                                            {suggestedTotal !== null && suggestedTotal !== editedTotal && (
                                                <p className="text-[12px] text-amber-700 mt-1">
                                                    दुसऱ्या वाचनात: <button className="font-bold underline" onClick={() => { setEditedTotal(suggestedTotal!); setSuggestedTotal(null); }}>₹{suggestedTotal}</button>
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Scope Selection */}
                                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                        <ScopeSelectorRadio
                                            value={scope}
                                            onChange={setScope}
                                            plotName={chosenPlotName}
                                            cropName={chosenCropName}
                                        />

                                        {/* Conditional Context Selectors */}
                                        {scope === 'PLOT' && (
                                            <div className="mt-4 animate-in fade-in">
                                                <label className="text-[13px] font-bold text-stone-600">कोणता प्लॉट?</label>
                                                <select
                                                    value={selectedPlotId}
                                                    onChange={(e) => setSelectedPlotId(e.target.value)}
                                                    className="w-full mt-1 p-3 bg-gray-50 rounded-lg font-bold text-gray-700 outline-none border border-gray-200 focus:border-emerald-500"
                                                >
                                                    <option value="">— प्लॉट निवडा —</option>
                                                    {crops.flatMap(c => c.plots).map(p => (
                                                        <option key={p.id} value={p.id}>{p.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {scope === 'CROP' && (
                                            <div className="mt-4 animate-in fade-in">
                                                <label className="text-[13px] font-bold text-stone-600">कोणतं पीक?</label>
                                                <select
                                                    value={selectedCropId}
                                                    onChange={(e) => setSelectedCropId(e.target.value)}
                                                    className="w-full mt-1 p-3 bg-gray-50 rounded-lg font-bold text-gray-700 outline-none border border-gray-200 focus:border-emerald-500"
                                                >
                                                    <option value="">— पीक निवडा —</option>
                                                    {crops.map(c => (
                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                {image && !isExtracting && extraction && (
                    <div className="flex-none p-4 bg-white border-t border-gray-100 flex gap-3">
                        <button onClick={onClose} className="flex-1 py-4 text-stone-600 font-bold hover:bg-gray-50 rounded-xl">रद्द करा</button>
                        <button
                            onClick={handleConfirm}
                            disabled={!isGivenAmount(editedTotal) || (scope === 'PLOT' && !selectedPlotId) || (scope === 'CROP' && !selectedCropId)}
                            className="flex-[2] py-4 bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                        >
                            <Check size={20} /> खर्च म्हणून जतन करा
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
