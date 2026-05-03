import React, { useState } from 'react';
import { CropProfile, ResourceItem } from '../../../../types';
import Step1_CropSelection from './steps/Step1_CropSelection';
import Step2_LandPrep from './steps/Step2_LandPrep';
import Step3_GrowthStages from './steps/Step3_GrowthStages';
import SlidingCropSelector from '../../../context/components/SlidingCropSelector';
import ScheduleSelector from '../ScheduleSelector';
import { Save, CheckCircle2, Sprout, Plus, MapPin, ArrowRight, BookOpen } from 'lucide-react';
import { getDaysSinceStart } from '../../../../features/scheduler/planning/ClientPlanEngine';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';

interface ScheduleMakerProps {
    crops: CropProfile[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    initialData?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    onSave: (schedule: any) => void;
    onCancel: () => void;
    userResources: ResourceItem[];
    onAddResource: (r: ResourceItem) => void;
}

const ScheduleMaker: React.FC<ScheduleMakerProps> = ({ crops, onSave, onCancel: _onCancel, userResources, onAddResource }) => {
    // 0 = Intent (Modify vs New), 1 = Crop/Date, 2 = Prep, 3 = Stages
    const [activeSection, setActiveSection] = useState<number>(0);

    // Modify Selection State (Step 0)
    const [modifyCropId, setModifyCropId] = useState<string>('');
    const [modifyPlotId, setModifyPlotId] = useState<string>('');

    // Draft Schedule State
    const [draftSchedule, setDraftSchedule] = useState({
        cropId: '',
        plotId: '',
        plantationDate: getDateKey(),
        landPrepDuration: 15,
        prepActivities: [],
        stages: [],
        name: 'My New Schedule',
        selectedTemplateId: '' as string, // MANDATORY: Must select before proceeding
    });

    // Calculate days elapsed for Contextual UI in Step 3
    const daysSincePlantation = getDaysSinceStart(draftSchedule.plantationDate);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    const handleUpdate = (field: string, value: any) => {
        setDraftSchedule(prev => ({ ...prev, [field]: value }));
        // If updating section via 'section' field
        if (field === 'section') {
            setActiveSection(value);
        }
    };

    // Helper to render connector lines
    const Connector = ({ active }: { active: boolean }) => (
        <div className="flex justify-center h-4">
            <div className={`w-0.5 ${active ? 'bg-indigo-500' : 'bg-stone-200'} transition-colors duration-500`} />
        </div>
    );

    // Get Active Crop for Modify Selector
    const activeModifyCrop = crops.find(c => c.id === modifyCropId);

    return (
        <div className="max-w-3xl mx-auto pb-24 animate-in fade-in slide-in-from-bottom-8">
            {/* Header */}
            <div className="text-center mb-10">
                <h2 className="text-3xl font-black text-stone-800 tracking-tight mb-2">Schedule Maker</h2>
                <p className="text-stone-500 font-medium">Build your master plan in one seamless flow.</p>
            </div>

            {/* STEP 0: INTENT SELECTION (Modifying existing or Creating new?) */}
            {activeSection === 0 && (
                <div className="flex flex-col gap-6 animate-in slide-in-from-bottom-4">
                    {/* Option A: Modify Existing (Active Crops) - RICH SELECTOR */}
                    <div className="bg-white p-6 rounded-3xl border border-stone-100 shadow-xl shadow-stone-200/50 hover:border-emerald-200 transition-all group">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                <Sprout size={24} strokeWidth={2.5} />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black text-stone-700 leading-none mb-1">Modify for your crops</h3>
                                <p className="text-stone-400 font-bold">Select a crop & plot to edit its plan.</p>
                            </div>
                        </div>

                        {/* 1. Crop Selector */}
                        <div className="mb-6 bg-stone-50 p-6 rounded-[2rem] border border-stone-100">
                            <SlidingCropSelector
                                crops={crops}
                                selectedCropId={modifyCropId}
                                onSelect={(id) => {
                                    setModifyCropId(id);
                                    setModifyPlotId(''); // Reset plot on crop change
                                }}
                            />
                        </div>

                        {/* 2. Plot Selector */}
                        {activeModifyCrop && activeModifyCrop.plots.length > 0 && (
                            <div className="animate-in fade-in slide-in-from-top-2 text-center">
                                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Select Plot</p>
                                <div className="flex flex-wrap justify-center gap-3 mb-6">
                                    {activeModifyCrop.plots.map(plot => {
                                        const isSelected = modifyPlotId === plot.id;
                                        return (
                                            <button
                                                key={plot.id}
                                                onClick={() => setModifyPlotId(plot.id)}
                                                className={`
                                                    flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all
                                                    ${isSelected
                                                        ? 'bg-stone-800 text-white shadow-lg shadow-stone-800/20 scale-105 ring-2 ring-stone-800 ring-offset-2'
                                                        : 'bg-white border border-stone-200 text-stone-500 hover:bg-stone-50'
                                                    }
                                                `}
                                            >
                                                <MapPin size={16} className={isSelected ? 'text-emerald-400' : 'text-stone-300'} />
                                                <span>{plot.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* 3. Context & Action Button (Only if Plot Selected) */}
                                {modifyPlotId && (() => {
                                    const plot = activeModifyCrop.plots.find(p => p.id === modifyPlotId);
                                    const days = plot ? getDaysSinceStart(plot.startDate || '') : 0;

                                    return (
                                        <div className="animate-in zoom-in space-y-4">
                                            {/* Context Banner */}
                                            <div className="inline-block bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2">
                                                <div className="flex items-center gap-2 text-emerald-800">
                                                    <span className="text-xs font-bold uppercase tracking-wider">Current Status</span>
                                                    <span className="w-1 h-3 bg-emerald-300 rounded-full" />
                                                    <span className="font-black text-lg">Day {days}</span>
                                                </div>
                                            </div>

                                            <div>
                                                <button
                                                    onClick={() => {
                                                        const plot = activeModifyCrop.plots.find(p => p.id === modifyPlotId);
                                                        setDraftSchedule(prev => ({
                                                            ...prev,
                                                            cropId: activeModifyCrop.id,
                                                            plotId: modifyPlotId,
                                                            plantationDate: plot?.startDate || getDateKey()
                                                        }));
                                                        // Direct jump to Stages (Step 3) if established
                                                        setActiveSection(3);
                                                    }}
                                                    className="bg-emerald-500 text-white px-8 py-4 rounded-2xl font-black text-lg shadow-xl shadow-emerald-500/30 hover:bg-emerald-600 hover:scale-105 active:scale-95 transition-all inline-flex items-center gap-3"
                                                >
                                                    Edit Schedule Plan <ArrowRight size={24} strokeWidth={3} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {!activeModifyCrop && crops.length === 0 && (
                            <div className="text-center text-stone-400 italic text-sm">No active crops found.</div>
                        )}
                    </div>

                    {/* Option B: Create New - HORIZONTAL BANNER */}
                    <div
                        onClick={() => setActiveSection(1)}
                        className="bg-stone-900 p-8 rounded-3xl border border-stone-800 shadow-xl shadow-stone-900/20 hover:bg-stone-800 cursor-pointer transition-all group flex flex-col sm:flex-row items-center justify-between gap-6 opacity-60 hover:opacity-100"
                    >
                        <div className="flex items-center gap-6 w-full sm:w-auto">
                            <div className="w-16 h-16 rounded-2xl bg-stone-800 text-white flex items-center justify-center group-hover:bg-stone-700 transition-colors flex-shrink-0">
                                <Plus size={32} strokeWidth={2.5} />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black text-white leading-none mb-1">Make new schedule</h3>
                                <p className="text-stone-400 font-bold">For a different or future crop.</p>
                            </div>
                        </div>
                        <span className="w-full sm:w-auto text-center bg-white text-stone-900 text-sm font-black px-8 py-4 rounded-full group-hover:scale-105 transition-transform whitespace-nowrap">
                            Start Fresh →
                        </span>
                    </div>
                </div>
            )}

            {/* SECTION 1: CROP & PLOT (Only shown if active >= 1) */}
            {activeSection >= 1 && (
                <>
                    <div className="relative">
                        <Step1_Wrapper
                            data={draftSchedule}
                            isActive={activeSection === 1}
                            onExpand={() => setActiveSection(1)}
                            onUpdate={handleUpdate}
                            crops={crops}
                        />
                    </div>
                    <Connector active={activeSection >= 1.5} />
                </>
            )}

            {/* SECTION 1.5: SCHEDULE TEMPLATE SELECTION (MANDATORY) */}
            {activeSection >= 1 && (
                <>
                    <div className="relative">
                        {activeSection === 1.5 ? (
                            <div className="bg-white rounded-3xl border-2 border-amber-50 shadow-xl shadow-amber-50/50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                                <div className="px-8 py-6 border-b border-amber-50 bg-amber-50/30">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
                                            <BookOpen size={20} strokeWidth={2.5} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-amber-900">Select Schedule</h3>
                                            <p className="text-stone-500 text-sm font-medium">Choose a proven plan to follow.</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <ScheduleSelector
                                        cropCode={(() => {
                                            const crop = crops.find(c => c.id === draftSchedule.cropId);
                                            return crop?.name?.toLowerCase() || '';
                                        })()}
                                        selectedTemplateId={draftSchedule.selectedTemplateId || null}
                                        onSelect={(templateId) => handleUpdate('selectedTemplateId', templateId)}
                                    />
                                </div>
                                <div className="px-8 pb-6 flex justify-between items-center">
                                    <button
                                        onClick={() => setActiveSection(1)}
                                        className="text-stone-400 font-bold text-sm hover:text-stone-600 transition-colors"
                                    >
                                        ← Back to Crop
                                    </button>
                                    <button
                                        onClick={() => setActiveSection(2)}
                                        disabled={!draftSchedule.selectedTemplateId}
                                        className={`
                                            px-6 py-3 rounded-2xl font-bold text-sm transition-all
                                            ${draftSchedule.selectedTemplateId
                                                ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20 hover:bg-amber-600 hover:scale-105 active:scale-95'
                                                : 'bg-stone-100 text-stone-300 cursor-not-allowed'
                                            }
                                        `}
                                    >
                                        Continue to Prep ↓
                                    </button>
                                </div>
                            </div>
                        ) : activeSection > 1.5 ? (
                            <div
                                onClick={() => setActiveSection(1.5)}
                                className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm flex items-center justify-between cursor-pointer hover:border-amber-100 transition-all group"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                                        <CheckCircle2 size={24} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-stone-700 text-lg">Schedule Selected</h3>
                                        <p className="text-xs text-stone-400 font-bold uppercase tracking-wider">
                                            Template: {draftSchedule.selectedTemplateId || 'None'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-amber-600 font-bold text-sm bg-amber-50 px-4 py-2 rounded-xl opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0">
                                    <span>Change Schedule</span>
                                </div>
                            </div>
                        ) : null}
                    </div>
                    <Connector active={activeSection >= 2} />
                </>
            )}

            {/* SECTION 2: LAND PREP */}
            {activeSection >= 1.5 && (
                <>
                    <div className="relative">
                        <Step2_LandPrep
                            data={draftSchedule}
                            isActive={activeSection === 2}
                            onExpand={() => setActiveSection(2)}
                            onUpdate={handleUpdate}
                        />
                    </div>
                    <Connector active={activeSection >= 3} />
                </>
            )}

            {/* SECTION 3: STAGES */}
            {activeSection >= 1.5 && (
                <>
                    <div className="relative">
                        <Step3_GrowthStages
                            data={draftSchedule}
                            isActive={activeSection === 3}
                            onExpand={() => setActiveSection(3)}
                            onUpdate={handleUpdate}
                            userResources={userResources}
                            onAddResource={onAddResource}
                            currentDayNumber={daysSincePlantation}
                        />
                    </div>

                    {/* Footer / Save */}
                    <div className="mt-12 mb-8 flex justify-center">
                        <button
                            onClick={() => onSave(draftSchedule)}
                            className="bg-stone-900 text-white px-8 py-4 rounded-2xl font-bold shadow-xl shadow-stone-900/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-3 w-full sm:w-auto justify-center"
                        >
                            <Save size={20} />
                            Save Schedule Plan
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

// Wrapper for Step 1 to match Card Style
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
const Step1_Wrapper: React.FC<any> = ({ data, isActive, onExpand, onUpdate, crops }) => {
    if (!isActive) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
        const selectedCrop = crops.find((c: any) => c.id === data.cropId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
        const selectedPlot = selectedCrop?.plots.find((p: any) => p.id === data.plotId);

        return (
            <div onClick={onExpand} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm flex items-center justify-between cursor-pointer hover:border-indigo-100 transition-all group">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <h3 className="font-bold text-stone-700 text-lg">{selectedCrop?.name || 'Crop Profile'}</h3>
                        <p className="text-xs text-stone-400 font-bold uppercase tracking-wider">
                            {selectedPlot?.name ? (
                                <span className="flex items-center gap-1">
                                    <MapPin size={10} strokeWidth={3} /> {selectedPlot.name}
                                </span>
                            ) : 'Selection Pending'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm bg-indigo-50 px-4 py-2 rounded-xl opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0">
                    <span>Go Back to Crop Selection</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-3xl border-2 border-indigo-50 shadow-xl shadow-indigo-50/50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
            <div className="px-8 py-6 border-b border-indigo-50 bg-indigo-50/30">
                <h3 className="text-xl font-black text-indigo-900">Crop Profile</h3>
                <p className="text-stone-500 text-sm font-medium">Select your target crop and plot.</p>
            </div>
            <div className="p-8">
                <Step1_CropSelection
                    crops={crops}
                    selectedCropId={data.cropId}
                    selectedPlotId={data.plotId}
                    plantationDate={data.plantationDate}
                    onUpdate={onUpdate}
                />

                <div className="flex justify-end mt-4">
                    <button onClick={() => onUpdate('section', 1.5)} className="text-indigo-600 font-bold text-sm hover:underline">Continue to Schedule Selection ↓</button>
                </div>
            </div>
        </div>
    );
}

export default ScheduleMaker;
