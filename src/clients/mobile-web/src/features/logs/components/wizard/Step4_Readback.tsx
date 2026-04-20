import React from 'react';
import SathiCard from '../../../sathi/components/SathiCard';
import SathiReadbackCard from '../../../sathi/components/SathiReadbackCard';
import Button from '../../../../shared/components/ui/Button';

interface Step4Props {
    summaryData: any[]; // Array of collected data items
    targetLabels: string[];
    onSubmit: () => void;
    onBack: () => void;
    onEditItem: (index: number) => void;
}

const Step4_Readback: React.FC<Step4Props> = ({ summaryData, targetLabels, onSubmit, onBack, onEditItem }) => {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
            <SathiCard
                message="Almost done! Just check everything."
                subMessage={`This will be saved for ${targetLabels.length === 1 ? targetLabels[0] : `${targetLabels.length} plots`}.`}
                variant="alert" // Using 'alert' style to grab attention for review, or 'neutral'
            />

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Save this log for</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {targetLabels.map((label) => (
                        <span
                            key={label}
                            className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800"
                        >
                            {label}
                        </span>
                    ))}
                </div>
            </div>

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
                    Save {targetLabels.length === 1 ? '1 Log' : `${targetLabels.length} Logs`}
                </Button>
            </div>
        </div>
    );
};

export default Step4_Readback;
