import React from 'react';
import { CheckCheck, Edit2 } from 'lucide-react';

interface SummaryItem {
    label: string;
    value: string;
    icon?: React.ReactNode;
}

interface SathiReadbackCardProps {
    title: string;
    items: SummaryItem[];
    onEdit?: () => void;
}

const SathiReadbackCard: React.FC<SathiReadbackCardProps> = ({ title, items, onEdit }) => {
    return (
        <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200 mb-4 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="font-bold text-stone-600 text-sm uppercase tracking-wide flex items-center gap-2">
                    <CheckCheck size={16} className="text-emerald-500" />
                    {title}
                </h3>
                {onEdit && (
                    <button
                        onClick={onEdit}
                        className="text-stone-400 hover:text-stone-600 p-1 rounded-full hover:bg-stone-100 transition-colors"
                    >
                        <Edit2 size={14} />
                    </button>
                )}
            </div>

            <div className="space-y-3">
                {items.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 bg-white p-3 rounded-xl border border-stone-100 shadow-sm">
                        {item.icon && (
                            <div className="text-stone-400 mt-0.5">
                                {item.icon}
                            </div>
                        )}
                        <div>
                            <p className="font-bold text-stone-800 text-base leading-tight">
                                {item.value}
                            </p>
                            <p className="text-stone-400 text-xs font-medium mt-0.5">
                                {item.label}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Visual Flair */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-emerald-50 to-transparent -mr-8 -mt-8 rounded-full opacity-50 pointer-events-none" />
        </div>
    );
};

export default SathiReadbackCard;
