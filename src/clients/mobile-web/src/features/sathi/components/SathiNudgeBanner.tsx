import React from 'react';
import { AlertCircle, Lightbulb } from 'lucide-react';

interface SathiNudgeBannerProps {
    message: string;
    type?: 'hint' | 'warning';
    actionLabel?: string;
    onAction?: () => void;
}

const SathiNudgeBanner: React.FC<SathiNudgeBannerProps> = ({
    message,
    type = 'hint',
    actionLabel,
    onAction
}) => {
    return (
        <div className={`
            flex items-start gap-3 p-3 rounded-xl border mb-4 animate-in fade-in slide-in-from-top-1
            ${type === 'hint' ? 'bg-indigo-50 border-indigo-100 text-indigo-800' : 'bg-amber-50 border-amber-100 text-amber-800'}
        `}>
            <div className={`mt-0.5 shrink-0 ${type === 'hint' ? 'text-indigo-500' : 'text-amber-500'}`}>
                {type === 'hint' ? <Lightbulb size={20} /> : <AlertCircle size={20} />}
            </div>

            <div className="flex-1">
                <p className="font-medium text-sm leading-relaxed">
                    {message}
                </p>

                {actionLabel && onAction && (
                    <button
                        onClick={onAction}
                        className={`mt-2 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${type === 'hint'
                                ? 'bg-indigo-100 hover:bg-indigo-200 text-indigo-700'
                                : 'bg-amber-100 hover:bg-amber-200 text-amber-700'
                            }`}
                    >
                        {actionLabel}
                    </button>
                )}
            </div>
        </div>
    );
};

export default SathiNudgeBanner;
