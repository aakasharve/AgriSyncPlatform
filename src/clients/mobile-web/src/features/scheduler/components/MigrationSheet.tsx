import React, { useState, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { agriSyncClient, CropScheduleTemplateDto, MigrateScheduleRequest } from '../../../infrastructure/api/AgriSyncClient';
import ScheduleSelector from './ScheduleSelector';

interface MigrationSheetProps {
    isOpen: boolean;
    cropKey: string;
    plotId: string;
    cycleId: string;
    farmId: string;
    currentTemplateId?: string;
    onClose: (didMigrate: boolean, result?: any) => void;
}

const REASON_OPTIONS = [
    { value: 'BetterFit', label: 'अधिक योग्य' },
    { value: 'WeatherShift', label: 'हवामान बदल' },
    { value: 'SwitchedCropVariety', label: 'वाण बदल' },
    { value: 'OwnerDirective', label: 'मालकाची सूचना' },
    { value: 'Other', label: 'इतर' }
];

export const MigrationSheet: React.FC<MigrationSheetProps> = ({
    isOpen,
    cropKey,
    plotId,
    cycleId,
    farmId,
    currentTemplateId,
    onClose
}) => {
    const [selectedReason, setSelectedReason] = useState<string>('');
    const [reasonText, setReasonText] = useState<string>('');
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Reset state on open
    useEffect(() => {
        if (isOpen) {
            setSelectedReason('');
            setReasonText('');
            setSelectedTemplateId(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleMigrate = async () => {
        if (!selectedTemplateId || !selectedReason) return;
        setIsSubmitting(true);
        try {
            const body: MigrateScheduleRequest = {
                farmId,
                newScheduleTemplateId: selectedTemplateId,
                reason: selectedReason,
                reasonText: reasonText ? reasonText.trim() : undefined
            };
            const result = await agriSyncClient.migrateSchedule(plotId, cycleId, body);
            console.log('वेळापत्रक बदलले!');
            onClose(true, result);
        } catch (err) {
            console.error("Migration failed", err);
            alert('Failed to migrate');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" 
                onClick={() => !isSubmitting && onClose(false)} 
            />

            {/* Sheet Content */}
            <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-xl flex flex-col max-h-[90vh] overflow-hidden transform transition-transform duration-200">
                <div className="mx-auto w-12 h-1.5 bg-gray-200 rounded-full mt-3 mb-1 sm:hidden" />
                
                <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
                    <h2 className="text-xl font-bold text-gray-900" style={{ fontFamily: '"Noto Serif Devanagari", serif' }}>
                        वेळापत्रक बदला
                    </h2>
                    <button 
                        onClick={() => !isSubmitting && onClose(false)}
                        className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                    {/* Section 1: Reason Selector */}
                    <div>
                        <h3 className="text-sm font-bold text-gray-700 mb-3" style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                            कारण निवडा
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {REASON_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => setSelectedReason(opt.value)}
                                    className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                                        selectedReason === opt.value
                                            ? 'bg-[#fdf9f0] border-[#145225] text-[#145225] ring-1 ring-[#145225]'
                                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Section 2: Template Selector */}
                    <div>
                        <h3 className="text-sm font-bold text-gray-700 mb-3" style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                            नवीन वेळापत्रक निवडा
                        </h3>
                        {/* We use ScheduleSelector. It will query the template catalog internally. 
                            Wait, in the design, it just embeds the component. We can pass the cropKey to it.
                            We must make sure currentTemplateId is visually excluded, but for now it's fine. */}
                        <ScheduleSelector 
                            cropCode={cropKey} 
                            selectedTemplateId={selectedTemplateId} 
                            onSelect={setSelectedTemplateId} 
                        />
                    </div>

                    {/* Section 3: Optional Text Input */}
                    <div>
                        <input 
                            type="text" 
                            placeholder="कारण सांगा (ऐच्छिक)"
                            value={reasonText}
                            onChange={(e) => setReasonText(e.target.value)}
                            className="w-full bg-[#f7f3ea] border border-transparent focus:border-[#145225] focus:ring-1 focus:ring-[#145225] rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-500 outline-none transition-all"
                            style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
                    <button
                        disabled={!selectedTemplateId || !selectedReason || isSubmitting}
                        onClick={handleMigrate}
                        className="w-full flex items-center justify-center py-3.5 bg-[#145225] text-white rounded-xl font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                    >
                        {isSubmitting ? <Loader2 className="animate-spin mr-2" size={18} /> : null}
                        वेळापत्रक बदला
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MigrationSheet;
