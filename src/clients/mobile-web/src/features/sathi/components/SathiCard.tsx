import React from 'react';
import { User, MessageCircle } from 'lucide-react';

interface SathiCardProps {
    message: string;
    subMessage?: string;
    actionLabel?: string;
    onAction?: () => void;
    variant?: 'neutral' | 'success' | 'alert';
    className?: string; // Allow custom styling
}

const SathiCard: React.FC<SathiCardProps> = ({
    message,
    subMessage,
    actionLabel,
    onAction,
    variant = 'neutral',
    className = ''
}) => {

    const getBgColor = () => {
        switch (variant) {
            case 'success': return 'bg-emerald-50 border-emerald-100';
            case 'alert': return 'bg-amber-50 border-amber-100';
            default: return 'bg-white border-stone-200';
        }
    };

    const getIconColor = () => {
        switch (variant) {
            case 'success': return 'text-emerald-600';
            case 'alert': return 'text-amber-600';
            default: return 'text-stone-400';
        }
    };

    return (
        <div className={`w-full p-4 rounded-3xl border-2 shadow-sm flex items-start gap-4 ${getBgColor()} ${className}`}>
            <div className={`p-3 bg-white rounded-full shadow-sm shrink-0 ${getIconColor()}`}>
                <User size={24} strokeWidth={2.5} />
            </div>

            <div className="flex-1 pt-1">
                <h3 className="font-bold text-lg text-stone-800 leading-tight mb-1">
                    {message}
                </h3>
                {subMessage && (
                    <p className="text-stone-500 font-medium text-sm leading-relaxed">
                        {subMessage}
                    </p>
                )}

                {actionLabel && onAction && (
                    <div className="mt-3">
                        <button
                            onClick={onAction}
                            className="bg-stone-800 text-white font-bold text-sm px-4 py-2 rounded-xl active:scale-95 transition-transform flex items-center gap-2"
                        >
                            <span>{actionLabel}</span>
                            <MessageCircle size={14} className="text-stone-300" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SathiCard;
