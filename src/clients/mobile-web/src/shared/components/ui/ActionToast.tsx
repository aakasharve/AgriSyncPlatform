import React, { useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';

/**
 * Labour Phase 2 -> Phase 1, Task T2 (review round 1, §R6 item 2).
 *
 * `'partial'` exists because this component offered only success and error, and
 * a partly-skipped save is neither. It was rendering red with an `XCircle` —
 * the "everything is gone" signal — over a record that IS safely in the local
 * ledger and simply has not been queued for the server. A farmer who reads
 * "gone" re-records, and the app ends the day holding two of the same log. The
 * leading `फोनवर सेव्ह ✓` was a mitigation, not a cure; the cure is not to
 * raise an alarm we do not mean.
 *
 * Amber, not red, and an `AlertCircle` rather than an `XCircle`: this is an
 * incompleteness the farmer should notice, not a failure they should fear.
 */
type ActionToastType = 'success' | 'error' | 'partial';

interface ActionToastProps {
    message: string;
    type?: ActionToastType;
    duration?: number;
    onDismiss: () => void;
    actionLabel?: string;
    onAction?: () => void;
}

/**
 * How long each kind of message stays up.
 *
 * 3000ms is unchanged for success and error — every existing caller keeps its
 * exact behaviour. `'partial'` gets longer because the honest message is longer
 * than the lie it replaced ("फोनवर सेव्ह ✓ — 2 of 3 cannot be sent." against
 * "Logged.") and the audience may be reading slowly, in a second script, in
 * sunlight. Three seconds to read that is the same mistake the original 3s undo
 * pill made on the approval screen.
 */
const DEFAULT_DURATION_MS: Record<ActionToastType, number> = {
    success: 3000,
    error: 3000,
    partial: 7000,
};

const ActionToast: React.FC<ActionToastProps> = ({
    message,
    type = 'success',
    duration,
    onDismiss,
    actionLabel,
    onAction
}) => {
    const effectiveDuration = duration ?? DEFAULT_DURATION_MS[type];

    useEffect(() => {
        if (effectiveDuration > 0) {
            const timer = setTimeout(() => {
                onDismiss();
            }, effectiveDuration);
            return () => clearTimeout(timer);
        }
    }, [effectiveDuration, onDismiss]);

    return (
        <div
            className="fixed left-1/2 transform -translate-x-1/2 z-50 animate-slide-up w-[90%] max-w-sm"
            style={{ bottom: 'calc(6rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}
        >
            <div className={`
                flex items-center justify-between p-4 rounded-2xl shadow-hard border backdrop-blur-md
                ${type === 'success'
                    ? 'bg-emerald-900/90 border-emerald-500/30 text-emerald-50 shadow-emerald-900/40'
                    : type === 'partial'
                        ? 'bg-amber-900/90 border-amber-500/30 text-amber-50 shadow-amber-900/40'
                        : 'bg-red-900/90 border-red-500/30 text-red-50 shadow-red-900/40'}
            `}>
                <div className="flex items-center gap-3.5">
                    {type === 'success' ? (
                        <CheckCircle className="w-6 h-6 text-emerald-400 shrink-0" strokeWidth={2.5} />
                    ) : type === 'partial' ? (
                        <AlertCircle className="w-6 h-6 text-amber-400 shrink-0" strokeWidth={2.5} />
                    ) : (
                        <XCircle className="w-6 h-6 text-red-400 shrink-0" strokeWidth={2.5} />
                    )}
                    <span className="font-semibold text-sm leading-snug">{message}</span>
                </div>

                <div className="flex items-center gap-3 pl-3 border-l border-white/10 ml-2">
                    {actionLabel && onAction && (
                        <button
                            data-testid="action-toast-action"
                            onClick={onAction}
                            /* Task 21 (Labour V2 R1) — the audit found this
                               retry/action affordance at ~34px tall against the
                               Labour feature's own 56px floor ("no interactive
                               element below 56px tall", LabourHub.tsx). Padding
                               unchanged; `min-h-[56px]` plus centering brings the
                               tappable area up to the standard without changing
                               the button's visual weight. */
                            className="flex min-h-[56px] items-center justify-center text-xs font-bold uppercase tracking-wide px-3 py-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-colors active:scale-95"
                        >
                            {actionLabel}
                        </button>
                    )}
                    <button
                        data-testid="action-toast-dismiss"
                        onClick={onDismiss}
                        /* Task 21 — same 56px floor as the action button above,
                           applied here as a min-height/min-width tap area so the
                           icon itself stays visually unchanged. */
                        className="flex min-h-[56px] min-w-[56px] items-center justify-center hover:bg-white/10 rounded-full transition-colors active:scale-90"
                    >
                        <X className="w-4 h-4 opacity-70" strokeWidth={3} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ActionToast;
