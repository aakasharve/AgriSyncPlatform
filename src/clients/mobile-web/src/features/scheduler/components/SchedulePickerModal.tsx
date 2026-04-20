import React, { useEffect, useState } from 'react';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { agriSyncClient, CropScheduleTemplateDto } from '../../../infrastructure/api/AgriSyncClient';

interface SchedulePickerModalProps {
    isOpen: boolean;
    cropKey: string;
    plotId: string;
    cycleId: string;
    farmId: string;
    onClose: (didAdopt: boolean, subscription?: any) => void;
}

export const SchedulePickerModal: React.FC<SchedulePickerModalProps> = ({
    isOpen,
    cropKey,
    plotId,
    cycleId,
    farmId,
    onClose
}) => {
    const [templates, setTemplates] = useState<CropScheduleTemplateDto[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !cropKey) return;
        let alive = true;
        setIsLoading(true);
        setFetchError(null);
        setSelectedTemplateId(null);

        agriSyncClient.getCropScheduleTemplates(cropKey)
            .then(data => {
                if (!alive) return;
                setTemplates(data);
                if (data.length > 0) setSelectedTemplateId(data[0].id);
            })
            .catch(() => {
                if (alive) setFetchError('टेम्पलेट लोड होऊ शकले नाही. पुन्हा प्रयत्न करा.');
            })
            .finally(() => { if (alive) setIsLoading(false); });

        return () => { alive = false; };
    }, [isOpen, cropKey]);

    if (!isOpen) return null;

    const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

    const handleAdopt = async () => {
        if (!selectedTemplateId) return;
        setIsSubmitting(true);
        setFetchError(null);
        try {
            const result = await agriSyncClient.adoptSchedule(plotId, cycleId, {
                farmId,
                scheduleTemplateId: selectedTemplateId,
            });
            onClose(true, result);
        } catch {
            setFetchError('वेळापत्रक सुरू करण्यात अडचण आली. पुन्हा प्रयत्न करा.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-[#fdf9f0] animate-in fade-in duration-200">
            {/* Header */}
            <div className="pt-12 px-6 pb-4 flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-[#145225] leading-tight"
                        style={{ fontFamily: '"Noto Serif Devanagari", serif' }}>
                        कोणता वेळापत्रक<br />वापरायचे?
                    </h1>
                    <p className="text-[#2f6b3b] mt-2 text-sm font-medium opacity-70"
                       style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                        या पिकासाठी तज्ञांचे मार्गदर्शन निवडा
                    </p>
                </div>
                <button onClick={() => onClose(false)}
                    className="mt-1 p-2 rounded-full text-stone-400 hover:bg-stone-100 transition-colors"
                    aria-label="बंद करा">
                    <X size={20} />
                </button>
            </div>

            {/* Template list — renders API-fetched templates directly; does NOT use TemplateCatalog */}
            <div className="flex-1 overflow-y-auto px-6 pb-36">
                {isLoading ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-white/60 border border-[#e6e2d9] h-28 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                ) : fetchError && templates.length === 0 ? (
                    <p className="text-center text-red-500 text-sm py-8"
                       style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                        {fetchError}
                    </p>
                ) : templates.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-stone-400 text-sm"
                           style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                            या पिकासाठी वेळापत्रक उपलब्ध नाही.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {templates.map(t => {
                            const isSelected = t.id === selectedTemplateId;
                            return (
                                <button key={t.id} onClick={() => setSelectedTemplateId(t.id)}
                                    className={`w-full text-left rounded-2xl border-2 p-5 transition-all duration-200 ${
                                        isSelected
                                            ? 'border-[#145225] bg-[#145225]/5 shadow-md ring-2 ring-[#145225]/20 ring-offset-1'
                                            : 'border-[#e6e2d9] bg-white hover:border-[#a8c8b0] hover:shadow-sm'
                                    }`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <p className={`font-bold text-base leading-snug ${isSelected ? 'text-[#145225]' : 'text-stone-800'}`}
                                               style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                                                {t.name}
                                            </p>
                                            <div className="flex items-center gap-3 mt-2">
                                                <span className="text-xs font-semibold text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">
                                                    {t.versionTag}
                                                </span>
                                                <span className="text-xs text-stone-400">{t.tasks.length} कामे</span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5 mt-3">
                                                {t.tasks.slice(0, 3).map(task => (
                                                    <span key={task.id}
                                                          className="text-[10px] font-medium text-[#2f6b3b] bg-[#e8f5eb] px-2 py-0.5 rounded-full capitalize">
                                                        {task.taskType.replace(/_/g, ' ')}
                                                    </span>
                                                ))}
                                                {t.tasks.length > 3 && (
                                                    <span className="text-[10px] text-stone-400">+{t.tasks.length - 3} अधिक</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                                            isSelected ? 'bg-[#145225] text-white shadow-md' : 'border-2 border-stone-200'
                                        }`}>
                                            {isSelected && <Check size={14} strokeWidth={3} />}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer actions */}
            <div className="fixed bottom-0 left-0 right-0 px-6 pt-4 pb-8 bg-gradient-to-t from-[#fdf9f0] via-[#fdf9f0]/95 to-transparent">
                {fetchError && (
                    <p className="text-red-500 text-xs text-center mb-3"
                       style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                        {fetchError}
                    </p>
                )}
                {selectedTemplate && !isLoading && (
                    <p className="text-xs text-center text-stone-400 mb-2">
                        निवडले: <span className="font-semibold text-[#2f6b3b]">{selectedTemplate.name}</span>
                    </p>
                )}
                <button
                    disabled={!selectedTemplateId || isSubmitting || isLoading}
                    onClick={handleAdopt}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-[#145225] text-white rounded-2xl font-bold text-base shadow-lg shadow-[#145225]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                    style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                    {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <ChevronRight size={20} />}
                    हे वेळापत्रक सुरू करा
                </button>
                <button
                    disabled={isSubmitting}
                    onClick={() => onClose(false)}
                    className="w-full mt-3 text-stone-400 text-sm font-medium hover:text-stone-600 transition-colors py-2"
                    style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                    आत्ता नाही — नंतर निवडा
                </button>
            </div>
        </div>
    );
};

export default SchedulePickerModal;
