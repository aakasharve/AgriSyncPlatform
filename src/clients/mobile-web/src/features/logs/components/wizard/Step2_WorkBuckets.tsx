import React, { useState } from 'react';
import SathiCard from '../../../sathi/components/SathiCard';
import SathiQuickPickChips from '../../../sathi/components/SathiQuickPickChips';
import { Droplets, Users, Tractor, FlaskConical, Sprout } from 'lucide-react';
import Button from '../../../../shared/components/ui/Button';

interface Step2Props {
    plotName: string;
    onNext: (buckets: string[]) => void;
    onBack: () => void;
}

const Step2_WorkBuckets: React.FC<Step2Props> = ({ plotName, onNext, onBack }) => {
    const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);

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
                message={`What work happened on ${plotName}?`}
                subMessage="Select all that apply today."
                variant="neutral"
            />

            <div className="space-y-2">
                <SathiQuickPickChips
                    options={buckets}
                    selectedIds={selectedBuckets}
                    onToggle={toggleBucket}
                    layout="grid"
                    multiSelect={true}
                />
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
