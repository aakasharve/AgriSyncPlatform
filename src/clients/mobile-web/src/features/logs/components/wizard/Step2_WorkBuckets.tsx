import React, { useState } from 'react';
import SathiCard from '../../../sathi/components/SathiCard';
import { Check, Droplets, Users, Tractor, FlaskConical, Sprout } from 'lucide-react';
import Button from '../../../../shared/components/ui/Button';

interface Step2Props {
    plotName: string;
    initialBuckets?: string[];
    onNext: (buckets: string[]) => void;
    onBack: () => void;
}

const Step2_WorkBuckets: React.FC<Step2Props> = ({ plotName, initialBuckets, onNext, onBack }) => {
    const [selectedBuckets, setSelectedBuckets] = useState<string[]>(initialBuckets ?? []);

    const buckets = [
        { id: 'irrigation', label: 'Irrigation', icon: <Droplets size={18} /> },
        { id: 'inputs', label: 'Fertilizer/Spray', icon: <FlaskConical size={18} /> },
        { id: 'labour', label: 'Labour', icon: <Users size={18} /> },
        { id: 'machinery', label: 'Machinery', icon: <Tractor size={18} /> },
        { id: 'crop_activity', label: 'Crop Work (Pruning etc.)', icon: <Sprout size={18} /> },
    ];

    const toggleBucket = (id: string) => {
        setSelectedBuckets(prev =>
            prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
            <SathiCard
                message={`Choose the work done for ${plotName}.`}
                subMessage="Select all that apply today."
                variant="neutral"
            />

            <div className="grid grid-cols-2 gap-3">
                {buckets.map(bucket => {
                    const isSelected = selectedBuckets.includes(bucket.id);
                    const wasAiSuggested = initialBuckets?.includes(bucket.id) ?? false;

                    return (
                        <button
                            key={bucket.id}
                            type="button"
                            onClick={() => toggleBucket(bucket.id)}
                            className={`
                                relative flex w-full items-center gap-3 rounded-2xl border-2 px-5 py-3 text-left transition-all duration-200 active:scale-95
                                ${isSelected
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-md shadow-emerald-100'
                                    : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                                }
                            `}
                        >
                            {wasAiSuggested && (
                                <span className="absolute -top-1.5 -right-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
                                    AI
                                </span>
                            )}

                            <div className={`rounded-full p-2 ${isSelected ? 'bg-white/50 text-emerald-600' : 'bg-stone-100 text-stone-500'}`}>
                                {bucket.icon}
                            </div>

                            <span className={`text-lg font-bold leading-tight ${isSelected ? 'text-emerald-900' : 'text-stone-600'}`}>
                                {bucket.label}
                            </span>

                            {isSelected && (
                                <div className="absolute top-0 right-0 rounded-bl-xl bg-emerald-500 p-1 text-white">
                                    <Check size={12} strokeWidth={4} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="flex gap-3 pt-4">
                <Button
                    variant="secondary"
                    onClick={onBack}
                    className="flex-1 py-4"
                >
                    Back
                </Button>
                <Button
                    onClick={() => onNext(selectedBuckets)}
                    disabled={selectedBuckets.length === 0}
                    className="flex-[2] py-4 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg disabled:opacity-50 disabled:shadow-none"
                >
                    Continue
                </Button>
            </div>
        </div>
    );
};

export default Step2_WorkBuckets;
