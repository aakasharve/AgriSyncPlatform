import React, { useState } from 'react';
import SathiCard from '../../../sathi/components/SathiCard';
import Button from '../../../../shared/components/ui/Button';
import { IrrigationEvent, LabourEvent, MachineryEvent, InputEvent, CropActivityEvent } from '../../../../types'; // Adjusted imports

// NOTE: We are creating a simplified, unified interface for this step.
// In a real implementation, we might import specific sub-forms (IrrigationForm, LabourForm) 
// or build them inline here for the "Lite" version.

interface Step3Props {
    bucket: string; // 'irrigation' | 'labour' | 'inputs' | ...
    onNext: (data: any) => void;
    onBack: () => void;
    // We would pass specific data/defaults here
    defaults?: any;
}

const Step3_Details: React.FC<Step3Props> = ({ bucket, onNext, onBack }) => {
    // Local state for the specific bucket's data
    // This is a placeholder for the actual form fields
    const [formData, setFormData] = useState<any>({});

    const getTitle = () => {
        switch (bucket) {
            case 'irrigation': return 'Irrigation Details';
            case 'labour': return 'Labour Details';
            case 'inputs': return 'Fertilizer & Sprays';
            case 'machinery': return 'Machinery Usage';
            default: return 'Work Details';
        }
    };

    const getSubtitle = () => {
        switch (bucket) {
            case 'irrigation': return 'How long did you water?';
            case 'labour': return 'Who worked today?';
            case 'inputs': return 'What did you apply?';
            case 'machinery': return 'Which machine used?';
            default: return 'Enter details';
        }
    };

    // --- MOCKED FORM FIELDS FOR DEMO ---
    const renderFields = () => {
        switch (bucket) {
            case 'irrigation':
                return (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-stone-500 mb-1">Duration (Hours)</label>
                            <input
                                type="number"
                                className="w-full text-2xl font-bold p-4 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-emerald-500 transition-colors"
                                placeholder="0"
                                onChange={e => setFormData({ ...formData, durationHours: parseFloat(e.target.value) })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-stone-500 mb-1">Method</label>
                            <div className="flex gap-2">
                                {['Drip', 'Flood', 'Sprinkler'].map(m => (
                                    <button
                                        key={m}
                                        onClick={() => setFormData({ ...formData, method: m })}
                                        className={`px-4 py-2 rounded-lg font-bold border-2 ${formData.method === m ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-stone-100 text-stone-400'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'labour':
                return (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-stone-500 mb-1">Total Workers</label>
                            <input
                                type="number"
                                className="w-full text-2xl font-bold p-4 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-emerald-500 transition-colors"
                                placeholder="0"
                                onChange={e => setFormData({ ...formData, count: parseInt(e.target.value) })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-stone-500 mb-1">Total Cost (₹)</label>
                            <input
                                type="number"
                                className="w-full text-2xl font-bold p-4 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-emerald-500 transition-colors"
                                placeholder="0"
                                onChange={e => setFormData({ ...formData, totalCost: parseFloat(e.target.value) })}
                            />
                        </div>
                    </div>
                );
            // ... Add other cases as needed
            default:
                return (
                    <div className="p-4 bg-stone-100 rounded-xl text-stone-400">
                        Generic form for {bucket}
                    </div>
                );
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
            <SathiCard
                message={getTitle()}
                subMessage={getSubtitle()}
                variant="neutral"
            />

            <div className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm">
                {renderFields()}
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
                    onClick={() => onNext(formData)}
                    className="flex-[2] py-4 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
                >
                    Next Interest
                </Button>
            </div>
        </div>
    );
};

export default Step3_Details;
