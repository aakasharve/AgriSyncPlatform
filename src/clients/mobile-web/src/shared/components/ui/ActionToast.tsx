import React, { useEffect } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

interface ActionToastProps {
    message: string;
    type?: 'success' | 'error';
    duration?: number;
    onDismiss: () => void;
    actionLabel?: string;
    onAction?: () => void;
}

const ActionToast: React.FC<ActionToastProps> = ({
    message,
    type = 'success',
    duration = 3000,
    onDismiss,
    actionLabel,
    onAction
}) => {
    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => {
                onDismiss();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [duration, onDismiss]);

    return (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 animate-slide-up w-[90%] max-w-sm">
            <div className={`
                flex items-center justify-between p-4 rounded-2xl shadow-hard border backdrop-blur-md
                ${type === 'success'
                    ? 'bg-emerald-900/90 border-emerald-500/30 text-emerald-50 shadow-emerald-900/40'
                    : 'bg-red-900/90 border-red-500/30 text-red-50 shadow-red-900/40'}
            `}>
                <div className="flex items-center gap-3.5">
                    {type === 'success' ? (
                        <CheckCircle className="w-6 h-6 text-emerald-400 shrink-0" strokeWidth={2.5} />
                    ) : (
                        <XCircle className="w-6 h-6 text-red-400 shrink-0" strokeWidth={2.5} />
                    )}
                    <span className="font-semibold text-sm leading-snug">{message}</span>
                </div>

                <div className="flex items-center gap-3 pl-3 border-l border-white/10 ml-2">
                    {actionLabel && onAction && (
                        <button
                            onClick={onAction}
                            className="text-xs font-bold uppercase tracking-wide px-3 py-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-colors active:scale-95"
                        >
                            {actionLabel}
                        </button>
                    )}
                    <button
                        onClick={onDismiss}
                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors active:scale-90"
                    >
                        <X className="w-4 h-4 opacity-70" strokeWidth={3} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ActionToast;
