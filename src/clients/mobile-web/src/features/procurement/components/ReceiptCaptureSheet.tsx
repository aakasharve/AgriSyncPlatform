
import React, { useState, useRef } from 'react';
import { Camera, Upload, X, Check, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { extractReceiptWithSession, VerificationStatus } from '../receipt/receiptExtractionClient';
import { ReceiptExtractionResponse, ProcurementExpense, ExpenseScope, CropProfile, Plot } from '../../../types';
import { ScopeSelectorRadio } from './ScopeSelectorRadio';
import { procurementRepository } from '../../../services/procurementRepository';
import { v4 as uuidv4 } from 'uuid';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { financeCommandService } from '../../finance/financeCommandService';
import { MoneyCategory } from '../../finance/finance.types';
import { captureAttachment } from '../../../application/use-cases/CaptureAttachment';
import { resolveFarmIdFromSyncState } from '../../../infrastructure/sync/SyncContext';
import AllocationSelector from '../../finance/components/AllocationSelector';

const mapExpenseCategoryToMoneyCategory = (category: string): MoneyCategory => {
    if (category === 'LABOUR') return 'Labour';
    if (category === 'FUEL') return 'Fuel';
    if (category === 'MACHINERY_RENTAL') return 'Machinery';
    if (category === 'TRANSPORT') return 'Transport';
    if (category === 'ELECTRICITY') return 'Electricity';
    if (category === 'EQUIPMENT_REPAIR') return 'Repair';
    if (['FERTILIZER', 'PESTICIDE', 'FUNGICIDE', 'SEEDS_PLANTS', 'IRRIGATION'].includes(category)) return 'Input';
    return 'Other';
};

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

    // 2. Data State
    const [extraction, setExtraction] = useState<ReceiptExtractionResponse | null>(null);
    const [scope, setScope] = useState<ExpenseScope>('FARM'); // Default to FARM safe
    const [selectedPlotId, setSelectedPlotId] = useState<string>(activePlotId || '');
    const [selectedCropId, setSelectedCropId] = useState<string>('');

    // 3. User Edits (for correction)
    const [editedTotal, setEditedTotal] = useState<number>(0);
    const [editedVendor, setEditedVendor] = useState<string>('');
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [attachmentCaptureError, setAttachmentCaptureError] = useState<string | null>(null);
    const [queuedExtractionMessage, setQueuedExtractionMessage] = useState<string | null>(null);
    const [showAllocation, setShowAllocation] = useState(false);
    const [savedCostEntryId, setSavedCostEntryId] = useState<string>('');

    // 4. Verification state (two-lane progressive UX)
    const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
    // Suggestions for fields the user has already edited — never auto-overwrite, just hint
    const [suggestedTotal, setSuggestedTotal] = useState<number | null>(null);
    const [suggestedVendor, setSuggestedVendor] = useState<string | null>(null);
    // Whether the user has manually changed each field (guard against auto-overwrite)
    const [userEditedTotal, setUserEditedTotal] = useState(false);
    const [userEditedVendor, setUserEditedVendor] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- HANDLERS ---

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setAttachmentCaptureError(null);
        setAttachmentIds([]);
        void queueAttachmentCapture(file);

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64ForDisplay = reader.result as string;
            setImage(base64ForDisplay);
            processImage(base64ForDisplay);
        }
        reader.readAsDataURL(file);
    };

    const queueAttachmentCapture = async (file: File): Promise<void> => {
        try {
            const farmId = await resolveFarmIdFromSyncState(activePlotId);
            if (!farmId) {
                // Sync metadata not yet available — silently skip attachment queuing.
                // Receipt AI extraction still runs. Attachment can be re-linked after first sync.
                console.warn('[ReceiptCapture] Farm ID unavailable for attachment queue — skipping queue, extraction continues.');
                return;
            }

            const queued = await captureAttachment({
                source: 'file',
                farmId,
                linkedEntityId: farmId,
                linkedEntityType: 'Farm',
                file,
                fileName: file.name,
                mimeType: file.type
            });

            setAttachmentIds([queued.id]);
        } catch (error) {
            console.error('Attachment queue capture failed', error);
            // Silent — attachment upload failure does not block receipt extraction or saving.
        }
    };

    const processImage = async (base64: string) => {
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
                (update) => {
                    setVerificationStatus(update.status);

                    if (update.status === 'verified' && update.updated) {
                        const { grandTotal, vendorName } = update.updated;

                        if (grandTotal !== undefined) {
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
                setQueuedExtractionMessage(result.message || 'Saved locally. Will process when online.');
                return;
            }

            setExtraction(result);
            setEditedTotal(result.grandTotal || 0);
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
            alert("Failed to process image. Please try manual entry.");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleConfirm = () => {
        if (!extraction) return;

        // Construct final object
        const newExpense: ProcurementExpense = {
            id: uuidv4(),
            date: extraction.date || getDateKey(),
            createdAt: new Date().toISOString(),
            scope: scope,
            plotId: scope === 'PLOT' ? selectedPlotId : undefined,
            cropId: (scope === 'CROP' || scope === 'PLOT') ? selectedCropId : undefined,
            vendorName: editedVendor,
            lineItems: extraction.lineItems.map(i => ({ ...i, id: uuidv4(), totalAmount: i.totalAmount, category: i.suggestedCategory, unitPrice: i.unitPrice || 0 })), // Map lightly
            subtotal: extraction.subtotal || editedTotal,
            grandTotal: editedTotal,
            paymentStatus: 'PAID', // Default assumption, editable later
            receiptImageUrl: image || undefined, // In real app, upload to storage first!
            attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
            aiExtracted: true,
            userVerified: true,
            aiRawResponse: JSON.stringify(extraction)
        };

        procurementRepository.saveExpense(newExpense);

        newExpense.lineItems.forEach((item) => {
            financeCommandService.createMoneyEventFromSource({
                type: 'Procurement',
                sourceId: `${newExpense.id}:${item.id}`,
                dateTime: new Date(newExpense.date).toISOString(),
                eventType: 'Expense',
                category: mapExpenseCategoryToMoneyCategory(item.category),
                plotId: newExpense.plotId,
                cropId: newExpense.cropId,
                amount: item.totalAmount,
                qty: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice,
                paymentMode: newExpense.paymentStatus === 'CREDIT' ? 'Credit' : 'Cash',
                vendorName: newExpense.vendorName,
                createdByUserId: newExpense.operatorId || 'owner',
                attachments: newExpense.attachmentIds
                    ?? (newExpense.receiptImageUrl ? [newExpense.receiptImageUrl] : [])
            });
        });

        // If farm-scoped, show allocation step
        if (scope === 'FARM' && crops.flatMap(c => c.plots).length > 1) {
            setSavedCostEntryId(newExpense.id);
            setShowAllocation(true);
            onSave(); // Notify parent that expense is saved
            return;
        }

        onSave();
        onClose();
    };

    // --- RENDER ---

    return (
        <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-lg h-[90vh] sm:h-auto sm:max-h-[90vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">

                {/* HEAD */}
                <div className="flex-none p-4 border-b border-gray-100 flex items-center justify-between bg-white">
                    <h2 className="text-lg font-black text-gray-800">New Expense</h2>
                    <button onClick={onClose} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={20} /></button>
                </div>

                {/* BODY */}
                <div className="flex-1 overflow-y-auto p-4 bg-gray-50">

                    {/* 1. IMAGE CAPTURE */}
                    {!image && (
                        <div className="flex flex-col gap-4">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-emerald-600 text-white p-8 rounded-3xl shadow-xl flex flex-col items-center gap-4 active:scale-95 transition-all"
                            >
                                <div className="p-4 bg-white/20 rounded-full"><Camera size={48} /></div>
                                <div className="text-xl font-bold">Take Photo</div>
                                <span className="text-emerald-100 text-sm">Scan a receipt or bill</span>
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
                            <div className="text-center text-gray-400 text-sm font-medium p-4">
                                Smart Scan will extract items and prices automatically
                            </div>
                        </div>
                    )}

                    {/* 2. PREVIEW & PROCESSING */}
                    {image && (
                        <div className="flex flex-col gap-6">
                            {attachmentCaptureError && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                                    {attachmentCaptureError}
                                </div>
                            )}
                            {!attachmentCaptureError && attachmentIds.length > 0 && (
                                <div data-testid="attachment-queued-banner" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                    Attachment queued for background upload.
                                </div>
                            )}
                            {queuedExtractionMessage && (
                                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                                    {queuedExtractionMessage}
                                </div>
                            )}

                            {/* Image Thumbnail */}
                            <div className="relative w-full h-48 bg-black rounded-xl overflow-hidden shadow-sm shrink-0">
                                <img src={image} className="w-full h-full object-contain opacity-80" />
                                <button onClick={() => setImage(null)} className="absolute bottom-2 right-2 px-3 py-1 bg-black/60 text-white text-xs rounded-lg font-bold backdrop-blur-md border border-white/20">
                                    Retake
                                </button>
                            </div>

                            {/* LOADING STATE */}
                            {isExtracting && (
                                <div className="py-12 flex flex-col items-center justify-center text-emerald-600">
                                    <Loader2 size={40} className="animate-spin mb-4" />
                                    <p className="font-bold">Analyzing Receipt...</p>
                                    <p className="text-xs opacity-70">Detecting items & prices</p>
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
                                                <p className="text-amber-800 text-xs font-bold">Review Needed</p>
                                                <p className="text-amber-600 text-[10px]">Scan confidence is low. Please verify amounts.</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Verification Status Badge */}
                                    {verificationStatus === 'pending' || verificationStatus === 'verifying' ? (
                                        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-blue-700 text-xs font-semibold">
                                            <Loader2 size={13} className="animate-spin shrink-0" />
                                            Verifying bill with high-accuracy OCR...
                                        </div>
                                    ) : verificationStatus === 'verified' ? (
                                        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700 text-xs font-semibold">
                                            <Check size={13} className="shrink-0" />
                                            Verified ✓ — high-accuracy scan complete
                                        </div>
                                    ) : verificationStatus === 'needs_review' ? (
                                        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 text-xs font-semibold">
                                            <AlertTriangle size={13} className="shrink-0" />
                                            Verification flagged — please double-check amounts
                                        </div>
                                    ) : null}

                                    {/* Extracted Fields */}
                                    <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-4 shadow-sm">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Vendor/Shop</label>
                                            <input
                                                value={editedVendor}
                                                onChange={(e) => { setEditedVendor(e.target.value); setUserEditedVendor(true); }}
                                                className="w-full text-base font-bold text-gray-900 border-b border-gray-200 outline-none focus:border-emerald-500 py-1"
                                                placeholder="Enter vendor name"
                                            />
                                            {suggestedVendor && suggestedVendor !== editedVendor && (
                                                <p className="text-[10px] text-amber-600 mt-1">
                                                    AI suggests: <button className="font-bold underline" onClick={() => { setEditedVendor(suggestedVendor); setSuggestedVendor(null); }}>{suggestedVendor}</button>
                                                </p>
                                            )}
                                        </div>

                                        {/* Items List (Simplified for prototype) */}
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Items Found</label>
                                            {extraction.lineItems.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center text-sm py-1 border-b border-dotted border-gray-100 last:border-0">
                                                    <span className="text-gray-700 font-medium">{item.name} <span className="text-gray-400 text-xs">({item.quantity} {item.unit})</span></span>
                                                    <span className="font-bold text-gray-900">₹{item.totalAmount}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Total Amount</label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xl font-black text-gray-900">₹</span>
                                                <input
                                                    type="number"
                                                    value={editedTotal}
                                                    onChange={(e) => { setEditedTotal(Number(e.target.value)); setUserEditedTotal(true); }}
                                                    className="w-full text-2xl font-black text-gray-900 border-b border-gray-200 outline-none focus:border-emerald-500 py-1"
                                                />
                                            </div>
                                            {suggestedTotal !== null && suggestedTotal !== editedTotal && (
                                                <p className="text-[10px] text-amber-600 mt-1">
                                                    AI suggests: <button className="font-bold underline" onClick={() => { setEditedTotal(suggestedTotal!); setSuggestedTotal(null); }}>₹{suggestedTotal}</button>
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Scope Selection */}
                                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                        <ScopeSelectorRadio
                                            value={scope}
                                            onChange={setScope}
                                            plotName={activePlotId ? "Selected" : undefined}
                                            cropName="This Crop" // Could enhance context mapping
                                        />

                                        {/* Conditional Context Selectors */}
                                        {scope === 'PLOT' && (
                                            <div className="mt-4 animate-in fade-in">
                                                <label className="text-xs font-bold text-gray-500">Select which plot:</label>
                                                <select
                                                    value={selectedPlotId}
                                                    onChange={(e) => setSelectedPlotId(e.target.value)}
                                                    className="w-full mt-1 p-3 bg-gray-50 rounded-lg font-bold text-gray-700 outline-none border border-gray-200 focus:border-emerald-500"
                                                >
                                                    <option value="">-- Choose Plot --</option>
                                                    {crops.flatMap(c => c.plots).map(p => (
                                                        <option key={p.id} value={p.id}>{p.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {scope === 'CROP' && (
                                            <div className="mt-4 animate-in fade-in">
                                                <label className="text-xs font-bold text-gray-500">Select crop:</label>
                                                <select
                                                    value={selectedCropId}
                                                    onChange={(e) => setSelectedCropId(e.target.value)}
                                                    className="w-full mt-1 p-3 bg-gray-50 rounded-lg font-bold text-gray-700 outline-none border border-gray-200 focus:border-emerald-500"
                                                >
                                                    <option value="">-- Choose Crop --</option>
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

                {/* ALLOCATION FOLLOW-UP */}
                {showAllocation && (
                    <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                        <AllocationSelector
                            costEntryId={savedCostEntryId}
                            totalAmount={editedTotal}
                            plots={crops.flatMap(c => c.plots)}
                            onAllocate={() => onClose()}
                            onCancel={() => onClose()}
                        />
                    </div>
                )}

                {/* FOOTER */}
                {!showAllocation && image && !isExtracting && extraction && (
                    <div className="flex-none p-4 bg-white border-t border-gray-100 flex gap-3">
                        <button onClick={onClose} className="flex-1 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-xl">Cancel</button>
                        <button
                            onClick={handleConfirm}
                            disabled={!editedTotal || (scope === 'PLOT' && !selectedPlotId) || (scope === 'CROP' && !selectedCropId)}
                            className="flex-[2] py-4 bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                        >
                            <Check size={20} /> Convert to Expense
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
