/**
 * AssignWorkerSheet — bottom sheet to assign a worker to a job card.
 * CEI Phase 4 §4.8
 *
 * Lists farm members with role Worker | Mukadam.
 * Uses the MeContext farms + membership data passed via props.
 */

import React, { useState, useEffect } from 'react';
import type { JobCard } from '../../../domain/work/JobCard';
import type { AssignWorkerRequest } from '../data/jobCardsClient';
import { useFarmContext } from '../../../core/session/FarmContext';
import { getRoleLabel } from '../../../shared/roles/roleLabels';

interface FarmMember {
    userId: string;
    displayName: string;
    role: string;
    phoneMasked?: string;
}

interface AssignWorkerSheetProps {
    card: JobCard;
    farmId: string;
    /** Farm members to choose from. If not provided, shows an empty state. */
    members?: FarmMember[];
    onClose: () => void;
    onAssigned: (req: AssignWorkerRequest) => Promise<void>;
}

const getInitials = (name: string): string =>
    name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() ?? '')
        .join('');

const ASSIGNABLE_ROLES = ['Worker', 'Mukadam'];

const AssignWorkerSheet: React.FC<AssignWorkerSheetProps> = ({
    card,
    farmId,
    members = [],
    onClose,
    onAssigned,
}) => {
    const [selectedUserId, setSelectedUserId] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const assignableMembers = members.filter(m => ASSIGNABLE_ROLES.includes(m.role));

    const handleAssign = async () => {
        if (!selectedUserId) { setError('Select a worker to assign'); return; }
        setIsSaving(true);
        setError(null);
        try {
            await onAssigned({ workerUserId: selectedUserId });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to assign');
            setIsSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-t-[2rem] bg-white px-5 pb-8 pt-6 shadow-2xl max-h-[80vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Handle */}
                <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-stone-200" />

                <h2
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="text-lg font-black text-stone-900 mb-1"
                >
                    कामगार नेमणूक
                </h2>
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-xs text-stone-500 mb-5"
                >
                    Assign Worker — Job Card {card.id.slice(-6).toUpperCase()}
                </p>

                {assignableMembers.length === 0 ? (
                    <div className="py-8 text-center">
                        <p
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-sm text-stone-500"
                        >
                            कोणतेही कामगार उपलब्ध नाहीत
                        </p>
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-400 mt-1"
                        >
                            No Workers or Mukadams found on this farm
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 mb-5">
                        {assignableMembers.map(member => {
                            const roleLabel = getRoleLabel(member.role);
                            const isSelected = selectedUserId === member.userId;
                            return (
                                <button
                                    key={member.userId}
                                    onClick={() => setSelectedUserId(member.userId)}
                                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${isSelected
                                        ? 'border-stone-800 bg-stone-800 text-white'
                                        : 'border-stone-200 bg-white hover:border-stone-300'
                                        }`}
                                >
                                    <div
                                        className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${isSelected ? 'bg-white text-stone-800' : 'bg-stone-100 text-stone-600'}`}
                                    >
                                        {getInitials(member.displayName)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p
                                            className={`font-bold text-sm leading-tight truncate ${isSelected ? 'text-white' : 'text-stone-900'}`}
                                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                        >
                                            {member.displayName}
                                        </p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span
                                                className={`text-[10px] font-bold rounded-md border px-1.5 py-0.5 ${isSelected ? 'border-white/30 text-white' : roleLabel.badge}`}
                                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                                            >
                                                {roleLabel.mr}
                                            </span>
                                            {member.phoneMasked && (
                                                <span
                                                    className={`text-[10px] font-mono ${isSelected ? 'text-stone-300' : 'text-stone-400'}`}
                                                >
                                                    {member.phoneMasked}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {isSelected && (
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}

                {error && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 mb-4">
                        {error}
                    </div>
                )}

                <div className="flex gap-2">
                    <button
                        onClick={onClose}
                        className="flex-1 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleAssign}
                        disabled={isSaving || !selectedUserId}
                        className="flex-1 rounded-2xl bg-stone-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {isSaving ? 'Assigning…' : 'नेमणूक करा'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AssignWorkerSheet;
