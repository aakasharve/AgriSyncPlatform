import React from 'react';
import { Check, X } from 'lucide-react';

interface VerifyActionBarProps {
    logId: string;
    onApprove: (id: string) => void;
    onRequestChange: (id: string) => void;
    isProcessing?: boolean;
}

const VerifyActionBar: React.FC<VerifyActionBarProps> = ({
    logId,
    onApprove,
    onRequestChange,
    isProcessing = false
}) => {
    return (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-stone-200 shadow-up-lg z-50 animate-in slide-in-from-bottom-4">
            <div className="max-w-md mx-auto flex gap-3">
                <button
                    onClick={() => onRequestChange(logId)}
                    disabled={isProcessing}
                    className="flex-1 flex items-center justify-center gap-2 bg-stone-100 text-stone-600 font-bold py-3.5 rounded-xl active:bg-stone-200 transition-colors disabled:opacity-50"
                >
                    <X size={20} />
                    <span>Change</span>
                </button>

                <button
                    onClick={() => onApprove(logId)}
                    disabled={isProcessing}
                    className="flex-[2] flex items-center justify-center gap-2 bg-emerald-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-200 active:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                    {isProcessing ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <Check size={20} strokeWidth={3} />
                    )}
                    <span>Approve Log</span>
                </button>
            </div>
        </div>
    );
};

export default VerifyActionBar;
