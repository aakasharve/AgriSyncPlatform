import React, { useState } from 'react';
import { Check, AlertTriangle, Clock } from 'lucide-react';
import VerificationReasonInput from './VerificationReasonInput';

interface AllowedTransition {
    targetStatus: string;
    requiredRole?: string;
    description?: string;
}

interface VerifyActionBarProps {
    logId: string;
    currentStatus?: string;
    allowedTransitions?: AllowedTransition[];
    onTransition: (logId: string, targetStatus: string, reason?: string) => void;
    isProcessing?: boolean;
}

const TRANSITION_CONFIG: Record<string, { label: string; Icon: React.FC<{ size?: number; strokeWidth?: number }>; bgClass: string; textClass: string }> = {
    confirmed: {
        label: 'Confirm',
        Icon: Check,
        bgClass: 'bg-blue-600 shadow-blue-200 active:bg-blue-700',
        textClass: 'text-white',
    },
    verified: {
        label: 'Verify',
        Icon: Check,
        bgClass: 'bg-emerald-600 shadow-emerald-200 active:bg-emerald-700',
        textClass: 'text-white',
    },
    disputed: {
        label: 'Dispute',
        Icon: AlertTriangle,
        bgClass: 'bg-red-100 active:bg-red-200',
        textClass: 'text-red-700',
    },
    correction_pending: {
        label: 'Request Correction',
        Icon: Clock,
        bgClass: 'bg-amber-100 active:bg-amber-200',
        textClass: 'text-amber-700',
    },
};

const NEEDS_REASON = new Set(['disputed', 'correction_pending']);

const VerifyActionBar: React.FC<VerifyActionBarProps> = ({
    logId,
    currentStatus: _currentStatus,
    allowedTransitions,
    onTransition,
    isProcessing = false,
}) => {
    const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
    const [reason, setReason] = useState('');

    // Fallback: if no transitions provided, use classic binary approve/reject
    const transitions: AllowedTransition[] = allowedTransitions && allowedTransitions.length > 0
        ? allowedTransitions
        : [
            { targetStatus: 'verified', description: 'Approve this log' },
            { targetStatus: 'disputed', description: 'Request changes' },
        ];

    const handleTransition = (targetStatus: string) => {
        if (NEEDS_REASON.has(targetStatus)) {
            setSelectedTransition(targetStatus);
            return;
        }
        onTransition(logId, targetStatus);
    };

    const handleSubmitWithReason = () => {
        if (!selectedTransition || reason.trim().length === 0) return;
        onTransition(logId, selectedTransition, reason);
        setSelectedTransition(null);
        setReason('');
    };

    const handleCancel = () => {
        setSelectedTransition(null);
        setReason('');
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-stone-200 bg-white/80 p-4 pb-safe-area backdrop-blur-md shadow-up-lg animate-in slide-in-from-bottom-4">
            <div className="page-content">
                {selectedTransition ? (
                    // Reason input mode
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold text-slate-700">
                                {TRANSITION_CONFIG[selectedTransition]?.label || selectedTransition}
                            </span>
                            <button
                                onClick={handleCancel}
                                className="ml-auto text-xs text-slate-400 hover:text-slate-600"
                            >
                                Cancel
                            </button>
                        </div>
                        <VerificationReasonInput
                            placeholder={
                                selectedTransition === 'disputed'
                                    ? 'Why is this wrong?'
                                    : 'What needs to be corrected?'
                            }
                            onReasonChange={setReason}
                        />
                        <button
                            onClick={handleSubmitWithReason}
                            disabled={isProcessing || reason.trim().length === 0}
                            className="w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-50 bg-slate-900 text-white active:bg-slate-800"
                        >
                            {isProcessing ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Check size={18} strokeWidth={3} />
                            )}
                            Submit
                        </button>
                    </div>
                ) : (
                    // Transition buttons mode
                    <div className="flex gap-2">
                        {transitions.map((t) => {
                            const config = TRANSITION_CONFIG[t.targetStatus];
                            if (!config) return null;

                            const isPositive = t.targetStatus === 'verified' || t.targetStatus === 'confirmed';
                            const { Icon, label, bgClass, textClass } = config;

                            return (
                                <button
                                    key={t.targetStatus}
                                    onClick={() => handleTransition(t.targetStatus)}
                                    disabled={isProcessing}
                                    className={`
                                        ${isPositive ? 'flex-[2]' : 'flex-1'}
                                        flex items-center justify-center gap-2 font-bold py-3.5 rounded-xl
                                        transition-colors disabled:opacity-50 text-sm
                                        ${isPositive ? 'shadow-lg' : 'border border-slate-200'}
                                        ${bgClass} ${textClass}
                                    `}
                                >
                                    {isProcessing && isPositive ? (
                                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <Icon size={18} strokeWidth={isPositive ? 3 : 2} />
                                    )}
                                    <span>{label}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default VerifyActionBar;
