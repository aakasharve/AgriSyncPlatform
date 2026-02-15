import React from 'react';
import SathiCard from '../../../sathi/components/SathiCard';
import SathiReadbackCard from '../../../sathi/components/SathiReadbackCard';
import Button from '../../../../shared/components/ui/Button';

interface Step4Props {
    summaryData: any[]; // Array of collected data items
    onSubmit: () => void;
    onBack: () => void;
    onEditItem: (index: number) => void;
}

const Step4_Readback: React.FC<Step4Props> = ({ summaryData, onSubmit, onBack, onEditItem }) => {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
            <SathiCard
                message="Almost done! Just check everything."
                subMessage="Does this look correct?"
                variant="alert" // Using 'alert' style to grab attention for review, or 'neutral'
            />

            <div className="space-y-3">
                {summaryData.map((item, idx) => (
                    <SathiReadbackCard
                        key={idx}
                        title={item.bucket?.toUpperCase() || 'ACTIVITY'}
                        items={item.summaryItems || []} // Assuming mapped format
                        onEdit={() => onEditItem(idx)}
                    />
                ))}
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
                    onClick={onSubmit}
                    className="flex-[2] py-4 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg text-lg font-bold"
                >
                    Save to Ledger
                </Button>
            </div>
        </div>
    );
};

export default Step4_Readback;
