/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — the bottom sheet both चाचण्या sheets sit
 * in (नमुना घेतला, निकाल नोंदवा): a dimmed backdrop that closes it, the icon + title, a Marathi close button,
 * and the test it is about. Presentational only. While saving, nothing outside the sheet's own buttons
 * closes it (the same guard each sheet had on its own).
 */
import React from 'react';
import { X } from 'lucide-react';
import type { DexieTestInstance } from '../../../infrastructure/storage/DexieDatabase';
import { IconDot, SANS, type Tone } from '../../../shared/components/ui/placeUi';
import { formatDayKey, testName, whereLine } from './testView';

interface TestSheetFrameProps {
    title: string;
    icon: React.ReactNode;
    tone: Tone;
    onClose: () => void;
    /** True while saving: the backdrop and the close button do nothing. */
    busy: boolean;
    testId: string;
    children: React.ReactNode;
}

export const TestSheetFrame: React.FC<TestSheetFrameProps> = ({ title, icon, tone, onClose, busy, testId, children }) => (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
        onClick={busy ? undefined : onClose} style={{ fontFamily: SANS }}>
        <div role="dialog" aria-modal="true" aria-label={title} data-testid={testId}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-white px-5 pb-6 pt-5 shadow-2xl sm:rounded-3xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
                <IconDot tone={tone}>{icon}</IconDot>
                <h3 className="m-0 min-w-0 flex-1 text-[19px] font-extrabold text-stone-900">{title}</h3>
                <button type="button" onClick={onClose} disabled={busy} aria-label="बंद करा"
                    className="grid min-h-[44px] min-w-[44px] place-items-center rounded-full text-stone-500 active:bg-stone-100 disabled:opacity-50">
                    <X size={22} aria-hidden="true" />
                </button>
            </div>
            {children}
        </div>
    </div>
);

/** Which test the sheet is about: what, where, and the planned day. */
export const SheetTestSummary: React.FC<{ instance: DexieTestInstance; name?: string }> = ({ instance, name }) => {
    const where = whereLine(instance);
    const due = formatDayKey(instance.plannedDueDate);
    return (
        <div className="mt-4 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
            <p className="m-0 truncate text-[16px] font-extrabold text-stone-900">{name ?? testName(instance)}</p>
            {(where || due) && (
                <p className="m-0 text-[13.5px] font-semibold text-stone-600">
                    {[where, due && `ठरलेली तारीख ${due}`].filter(Boolean).join(' · ')}
                </p>
            )}
        </div>
    );
};
