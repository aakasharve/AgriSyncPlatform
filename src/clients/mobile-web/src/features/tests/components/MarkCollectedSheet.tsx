/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — "नमुना घेतला?" in Marathi, on the shared
 * sheet frame. It was "Confirm sample collected / Not yet / Confirm". Behaviour unchanged (CEI Phase 2 §4.5
 * task 4.2.2): the simplest possible confirm — the collector is the caller (the server derives the user from
 * the JWT), and the action flips the instance to `Collected` through the real `markCollected`. No inputs, just
 * "was it really taken?" to avoid an accidental tap. A failure is said in Marathi (`failureWords`: no
 * permission / already moved on / try again); the server's English message is not shown to the farmer.
 *
 * Review B004: "हो, घेतला" stays off from the first tap until the page has finished taking the server's
 * answer (`onSuccess` is awaited). It used to come back on as soon as `/collect` answered, while the page was
 * still saving — a second tap then sent a second `/collect`. It comes back on only after a FAILED call.
 */
import React, { useRef, useState } from 'react';
import { TestTube } from 'lucide-react';
import type { DexieTestInstance } from '../../../infrastructure/storage/DexieDatabase';
import { markCollected } from '../data/testsClient';
import { useFarmContext } from '../../../core/session/FarmContext';
import { BigButton } from '../../../shared/components/ui/placeUi';
import { SheetTestSummary, TestSheetFrame } from './TestSheetFrame';
import { failureWords } from './testView';

interface MarkCollectedSheetProps {
    instance: DexieTestInstance;
    onClose: () => void;
    /** Awaited: the confirm button stays off until it settles. */
    onSuccess: (updated: DexieTestInstance) => void | Promise<void>;
}

const MarkCollectedSheet: React.FC<MarkCollectedSheetProps> = ({ instance, onClose, onSuccess }) => {
    const { meContext } = useFarmContext();
    const collectorName = meContext?.me.displayName ?? '';
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // A second tap can land before React has re-rendered the button as disabled.
    const inFlight = useRef(false);

    const handleConfirm = async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setIsSaving(true);
        setError(null);
        let updated: DexieTestInstance;
        try {
            updated = await markCollected(instance.id);
        } catch (e) {
            setError(failureWords(e, 'नोंद झाली नाही. पुन्हा प्रयत्न करा.'));
            inFlight.current = false;
            setIsSaving(false);
            return;
        }
        // The server has it now: never re-enabled, whatever the page does next (it closes this sheet).
        try {
            await onSuccess(updated);
        } catch (e) {
            console.error('[tests] sample marked collected on the server, but the page could not take the answer', { testInstanceId: instance.id, error: e });
        }
    };

    return (
        <TestSheetFrame title="नमुना घेतला?" icon={<TestTube size={22} aria-hidden="true" />} tone="amber"
            onClose={onClose} busy={isSaving} testId="collect-sheet">
            <p className="m-0 mt-4 rounded-2xl bg-amber-50 p-3 text-[14.5px] font-bold leading-snug text-amber-900 ring-1 ring-amber-200">
                आज नमुना घेतला गेला याची खात्री करा.
            </p>

            <SheetTestSummary instance={instance} />

            {collectorName && (
                <p className="m-0 mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[14px] font-bold text-stone-700 ring-1 ring-stone-200" data-testid="collect-by">
                    <span className="text-stone-500">कोणी घेतला:</span>{' '}
                    <span className="truncate text-stone-900">{collectorName}</span>
                </p>
            )}

            {error && (
                <p className="m-0 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[13.5px] font-extrabold text-rose-700 ring-1 ring-rose-200" data-testid="collect-error">
                    {error}
                </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
                <BigButton onClick={onClose} tone="white" disabled={isSaving} testId="collect-cancel">अजून नाही</BigButton>
                <BigButton onClick={handleConfirm} disabled={isSaving} testId="collect-confirm">
                    {isSaving ? 'नोंदवत आहे…' : 'हो, घेतला'}
                </BigButton>
            </div>
        </TestSheetFrame>
    );
};

export default MarkCollectedSheet;
