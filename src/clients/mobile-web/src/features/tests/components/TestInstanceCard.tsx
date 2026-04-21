/**
 * TestInstanceCard — row-style card used on TestQueuePage and TestDetailPage.
 *
 * Status→action mapping (CEI §4.5 / 4.2.1):
 *   Due or Overdue  → "Mark collected" (primary)
 *   Collected       → "Record result"
 *   Reported        → "View result" (secondary / ghost button)
 *   Waived          → no action button; rendered muted
 *
 * All labels are bilingual. Font rules:
 *   Marathi → Noto Sans Devanagari
 *   English / numbers / protocol codes → DM Sans (base font)
 */

import React from 'react';
import type { DexieTestInstance, DexieTestProtocol } from '../../../infrastructure/storage/DexieDatabase';
import { TestInstanceStatus } from '../../../domain/tests/TestInstance';

interface TestInstanceCardProps {
    instance: DexieTestInstance;
    /** Optional — if known, used for the parameter summary line. */
    protocol?: DexieTestProtocol;
    plotName?: string;
    onAction?: (instance: DexieTestInstance) => void;
    onOpen?: (instance: DexieTestInstance) => void;
}

const statusPill: Record<number, { bg: string; text: string; border: string; labelEn: string; labelMr: string }> = {
    [TestInstanceStatus.Due]:       { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   labelEn: 'Due',       labelMr: 'बाकी' },
    [TestInstanceStatus.Overdue]:   { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    labelEn: 'Overdue',   labelMr: 'उशीर' },
    [TestInstanceStatus.Collected]: { bg: 'bg-stone-100',  text: 'text-stone-700',   border: 'border-stone-200',   labelEn: 'Collected', labelMr: 'घेतला' },
    [TestInstanceStatus.Reported]:  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', labelEn: 'Reported',  labelMr: 'अहवाल' },
    [TestInstanceStatus.Waived]:    { bg: 'bg-stone-50',   text: 'text-stone-500',   border: 'border-stone-200',   labelEn: 'Waived',    labelMr: 'सूट' },
};

const kindLabel: Record<number, string> = {
    0: 'Soil', 1: 'Water', 2: 'Tissue', 3: 'Residue', 4: 'Other',
};

const daysBetween = (plannedIso: string): number => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const planned = new Date(plannedIso);
    planned.setHours(0, 0, 0, 0);
    return Math.floor((today.getTime() - planned.getTime()) / (1000 * 60 * 60 * 24));
};

const actionLabel = (status: number): { en: string; mr: string; primary: boolean } | null => {
    switch (status) {
        case TestInstanceStatus.Due:
        case TestInstanceStatus.Overdue:
            return { en: 'Mark collected', mr: 'नमुना घेतला', primary: true };
        case TestInstanceStatus.Collected:
            return { en: 'Record result', mr: 'निकाल नोंदवा', primary: true };
        case TestInstanceStatus.Reported:
            return { en: 'View result', mr: 'निकाल पहा', primary: false };
        default:
            return null;
    }
};

const TestInstanceCard: React.FC<TestInstanceCardProps> = ({ instance, protocol, plotName, onAction, onOpen }) => {
    const pill = statusPill[instance.status] ?? statusPill[TestInstanceStatus.Due];
    const action = actionLabel(instance.status);
    const overdueDays = instance.status === TestInstanceStatus.Overdue ? Math.max(0, daysBetween(instance.plannedDueDate)) : 0;

    const paramCodes = protocol?.parameterCodes ?? [];
    const paramCount = paramCodes.length;
    const paramPreview = paramCodes.slice(0, 4).join(', ');

    const protocolName = instance.testProtocolName ?? protocol?.name ?? kindLabel[instance.protocolKind] ?? 'Test';

    const handleOpen = () => onOpen?.(instance);
    const handleAction: React.MouseEventHandler<HTMLButtonElement> = (e) => {
        e.stopPropagation();
        onAction?.(instance);
    };

    return (
        <div
            onClick={handleOpen}
            className="rounded-2xl border border-stone-200 bg-white shadow-sm p-4 flex flex-col gap-3 active:bg-stone-50 transition-colors cursor-pointer"
        >
            {/* Top row: status pill + plot / stage */}
            <div className="flex items-start justify-between gap-3">
                <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${pill.bg} ${pill.text} ${pill.border}`}
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    <span>{pill.labelEn}</span>
                    <span className="mx-1 opacity-40">·</span>
                    <span style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>{pill.labelMr}</span>
                </span>
                <div className="text-right min-w-0">
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-xs font-semibold text-stone-700 truncate max-w-[160px]"
                    >
                        {plotName ?? instance.stageName}
                    </p>
                    <p
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        className="text-[11px] text-stone-400 truncate max-w-[160px]"
                    >
                        {instance.stageName}
                    </p>
                </div>
            </div>

            {/* Protocol name + kind */}
            <div>
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-base font-bold text-stone-800 leading-snug"
                >
                    {protocolName}
                </p>
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-[11px] uppercase tracking-wide text-stone-400 mt-0.5"
                >
                    {kindLabel[instance.protocolKind] ?? 'Test'}
                </p>
            </div>

            {/* Due date + overdue badge */}
            <div className="flex items-center gap-2 flex-wrap">
                <span
                    className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-600"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    Planned {instance.plannedDueDate}
                </span>
                {overdueDays > 0 && (
                    <span
                        className="rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs text-rose-700 font-bold"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {overdueDays} {overdueDays === 1 ? 'day' : 'days'} overdue
                    </span>
                )}
                {paramCount > 0 && (
                    <span
                        className="rounded-full bg-stone-50 border border-stone-200 px-2.5 py-0.5 text-xs text-stone-600"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        title={paramCodes.join(', ')}
                    >
                        {paramPreview}{paramCount > 4 ? '…' : ''} — {paramCount} {paramCount === 1 ? 'param' : 'params'}
                    </span>
                )}
            </div>

            {/* Primary action */}
            {action && onAction && (
                <button
                    type="button"
                    onClick={handleAction}
                    className={
                        action.primary
                            ? 'w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white active:bg-emerald-700 transition-colors'
                            : 'w-full rounded-xl border border-stone-200 bg-white py-2.5 text-sm font-semibold text-stone-700 active:bg-stone-50 transition-colors'
                    }
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    <span>{action.en}</span>
                    <span
                        className={action.primary ? 'text-emerald-100 ml-1.5 text-xs' : 'text-stone-400 ml-1.5 text-xs'}
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    >
                        · {action.mr}
                    </span>
                </button>
            )}
        </div>
    );
};

export default TestInstanceCard;
