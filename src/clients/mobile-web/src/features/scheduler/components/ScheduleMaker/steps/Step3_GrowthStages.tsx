import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { ResourceItem } from '../../../../../types';
import { idGenerator } from '../../../../../core/domain/services/IdGenerator';

// Define the default stages structure based on the Master Schedule
const DEFAULT_STAGES_CONFIG = [
    { name: 'Post Pruning', duration: 5 },
    { name: 'Budbreak Initiation', duration: 5 },
    { name: 'Sprouting Phase', duration: 5 },
    { name: 'Active Growth', duration: 5 },
    { name: 'Rapid Vegetative', duration: 5 },
    { name: 'Pre-Flowering', duration: 5 },
    { name: 'Flowering Init', duration: 5 },
    { name: 'Full Flowering', duration: 10 },
    { name: 'Flowering-Fruit Set', duration: 5 },
    { name: 'Fruit Set Phase', duration: 5 },
    { name: 'Berry Development', duration: 5 },
    { name: 'Fruit Expansion', duration: 10 },
    { name: 'Verasion', duration: 15 },
    { name: 'Harvest Period', duration: 20 },
];

interface Step3Props {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    data: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    onUpdate: (field: string, value: any) => void;
    isActive: boolean;
    onExpand: () => void;
    userResources: ResourceItem[];
    onAddResource: (r: ResourceItem) => void;
    currentDayNumber?: number; // Added for Modify Context
}

const SUGGESTIONS: ResourceItem[] = [
    { id: 'ir1', text: 'Manual Irrigation', type: 'IRRIGATION' },
    { id: 'ir2', text: 'Drip Irrigation', type: 'IRRIGATION' },
    { id: 'ir3', text: 'Sprinkler Irrigation', type: 'IRRIGATION' },
    { id: 'n1', text: 'N:P:K 19:19:19', type: 'NUTRITION' },
    { id: 'n2', text: 'Calcium Nitrate', type: 'NUTRITION' },
    { id: 'n3', text: 'Magnesium Sulphate', type: 'NUTRITION' },
    { id: 's1', text: 'Imidacloprid', type: 'SPRAY' },
    { id: 's2', text: 'Fungicide Mix', type: 'SPRAY' },
    { id: 's3', text: 'Neem Oil', type: 'SPRAY' },
    { id: 'ac1', text: 'Weeding', type: 'ACTIVITY' },
    { id: 'ac2', text: 'Pruning', type: 'ACTIVITY' },
    { id: 'ac3', text: 'Earthing Up', type: 'ACTIVITY' },
];

const DropZone: React.FC<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    items: any[],
    type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    suggestions: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    onDrop: (item: any) => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    onUpdateItem: (id: string, field: string, value: any) => void,
    onRemove: (id: string) => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    onAddSuggestion: (item: any) => void
}> = ({ items, type, suggestions, onDrop, onUpdateItem, onRemove, onAddSuggestion }) => {

    // Softer "Current UI" Aesthetic colors
    const styles = {
        NUTRITION: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100', label: 'Fertigation' },
        SPRAY: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-100', label: 'Spray' },
        IRRIGATION: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-100', label: 'Irrigation' },
        ACTIVITY: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', label: 'Activity' }
    }[type] || { bg: 'bg-stone-50', text: 'text-stone-700', border: 'border-stone-100', label: type };

    return (
        <div className="flex flex-col gap-2">
            {/* Main Drop Row */}
            <div className="flex items-stretch gap-3 min-h-[100px]">
                {/* Left Label Box */}
                <div className={`w-36 flex-shrink-0 rounded-2xl flex items-center justify-center p-3 text-center shadow-sm border-2 ${styles.bg} ${styles.border}`}>
                    <span className={`text-sm font-black uppercase tracking-wide ${styles.text}`}>{styles.label}</span>
                </div>

                {/* Right Drop Area */}
                <div
                    className="flex-1 bg-white rounded-2xl border-2 border-stone-200 transition-all hover:border-emerald-300 hover:bg-emerald-50/10 group/zone relative flex flex-col justify-center"
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-emerald-400', 'bg-emerald-50'); }}
                    onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-emerald-400', 'bg-emerald-50'); }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('border-emerald-400', 'bg-emerald-50');
                        const dataStr = e.dataTransfer.getData('application/json');
                        if (dataStr) {
                            const item = JSON.parse(dataStr);
                            if (item.type === type) onDrop(item);
                        }
                    }}
                >
                    {/* Items List */}
                    <div className="p-2 space-y-2 w-full">
                        {/* eslint-disable @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: item shape varies by category; revisit in V2. */}
                        {items?.map((item: any) => (
                            <div key={item.id} className="bg-stone-50 p-2 rounded-xl border border-stone-200 shadow-sm relative group/item flex items-center gap-3">
                                <div className="flex-1 flex flex-col gap-1 min-w-0">
                                    {type === 'IRRIGATION' ? (
                                        /* STRUCTURED IRRIGATION INPUTS */
                                        <div className="flex flex-col gap-1.5">
                                            <input
                                                value={item.text}
                                                onChange={(e) => onUpdateItem(item.id, 'text', e.target.value)}
                                                className="text-xs font-black text-blue-900 w-full bg-transparent outline-none truncate placeholder-blue-300/50"
                                                placeholder="Method (e.g. Drip)"
                                            />
                                            <div className="flex items-center gap-2">
                                                {/* Duration */}
                                                <div className="flex items-center bg-white border border-blue-100 rounded-md px-1.5 py-0.5 flex-1 shadow-sm">
                                                    <input
                                                        placeholder="Time"
                                                        value={item.duration || ''}
                                                        onChange={(e) => onUpdateItem(item.id, 'duration', e.target.value)}
                                                        className="w-full text-[10px] bg-transparent outline-none text-blue-800 font-bold text-center"
                                                    />
                                                    <span className="text-[9px] text-blue-300 font-bold ml-1">hrs</span>
                                                </div>
                                                {/* Volume & Unit */}
                                                <div className="flex items-center bg-white border border-blue-100 rounded-md px-1.5 py-0.5 flex-[1.5] shadow-sm gap-1">
                                                    <input
                                                        placeholder="Vol"
                                                        value={item.rate || ''}
                                                        onChange={(e) => onUpdateItem(item.id, 'rate', e.target.value)}
                                                        className="w-1/2 text-[10px] bg-transparent outline-none text-blue-800 font-bold text-right border-r border-blue-100 pr-1"
                                                    />
                                                    <input
                                                        placeholder="Unit"
                                                        value={item.unit || 'L'}
                                                        onChange={(e) => onUpdateItem(item.id, 'unit', e.target.value)}
                                                        className="w-1/2 text-[10px] bg-transparent outline-none text-blue-800 font-bold pl-1"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        /* GENERIC INPUTS (Nutrition, Spray, Activity) */
                                        <>
                                            <input
                                                value={item.text}
                                                onChange={(e) => onUpdateItem(item.id, 'text', e.target.value)}
                                                className="text-xs font-bold text-stone-700 w-full bg-transparent outline-none truncate"
                                                placeholder="Item Name"
                                            />
                                            {(type === 'NUTRITION' || type === 'SPRAY') && (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        placeholder="Qty"
                                                        value={item.rate || ''}
                                                        onChange={(e) => onUpdateItem(item.id, 'rate', e.target.value)}
                                                        className="w-12 text-[10px] bg-white border border-stone-200 rounded px-1 py-0.5 text-center outline-none focus:border-emerald-400"
                                                    />
                                                    <input
                                                        placeholder="Unit"
                                                        value={item.unit || ''}
                                                        onChange={(e) => onUpdateItem(item.id, 'unit', e.target.value)}
                                                        className="w-12 text-[10px] bg-white border border-stone-200 rounded px-1 py-0.5 text-center outline-none focus:border-emerald-400"
                                                    />
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                <button onClick={() => onRemove(item.id)} className="text-stone-300 hover:text-red-500 transition-colors px-1">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Empty Placeholder */}
                    {(!items || items.length === 0) && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-xs font-bold text-stone-300 uppercase tracking-widest text-center px-4">Drag Resources Here</span>
                        </div>
                    )}

                    {/* Count Badge */}
                    {items && items.length > 0 && (
                        <div className="absolute top-2 right-2 bg-stone-100 text-[9px] font-bold px-2 py-0.5 rounded-full text-stone-400 border border-stone-200">
                            {items.length}
                        </div>
                    )}
                </div>
            </div>

            {/* Inline Suggestions Section */}
            <div className="w-full mt-2">
                <div className="flex flex-wrap items-center gap-2 pb-2">
                    <span className="text-[9px] font-black text-stone-300 uppercase tracking-widest flex-shrink-0 mr-1">SUGGESTIONS:</span>
                    {suggestions?.map((item, idx) => (
                        <button
                            key={`${item.id}_${idx}`}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(item))}
                            onClick={() => onAddSuggestion(item)} // One-tap add
                            className={`flex-shrink-0 px-3 py-1 rounded-lg border text-[10px] font-bold whitespace-nowrap transition-all shadow-sm active:scale-95 hover:-translate-y-0.5 ${styles.bg} ${styles.border} ${styles.text}`}
                        >
                            + {item.text}
                        </button>
                    ))}
                    {(!suggestions || suggestions.length === 0) && (
                        <span className="text-[10px] font-medium text-stone-300 italic">No specific suggestions available.</span>
                    )}
                </div>
            </div>
        </div>
    );
};

const StageCard: React.FC<{
     
    stage: any,
    index: number,
     
    onUpdate: (field: string, value: any) => void,
    onRemove: () => void,
     
    onDropItem: (bucket: string, item: any) => void,
     
    onUpdateItem: (bucket: string, id: string, field: string, value: any) => void,
    onRemoveItem: (bucket: string, id: string) => void,
    // Day Specific Handlers
    onAddDay: () => void,
    onRemoveDay: (dayId: string) => void,
     
    onUpdateDay: (dayIndex: number, field: string, value: any) => void,
     
    onDropDayItem: (dayIndex: number, bucket: string, item: any) => void,
     
    onUpdateDayItem: (dayIndex: number, bucket: string, id: string, field: string, value: any) => void,
    onRemoveDayItem: (dayIndex: number, bucket: string, id: string) => void,
    // Resources
    resources: ResourceItem[],
    onAddResource: (type: string, name: string) => void,
    // Context Props
    status?: 'PAST' | 'CURRENT' | 'FUTURE',
    dayRange?: { start: number, end: number },
    domRef?: React.RefObject<HTMLDivElement | null>
}> = ({ stage, index, onUpdate, onRemove, onDropItem, onUpdateItem, onRemoveItem, onAddDay, onRemoveDay, onUpdateDay, onDropDayItem, onUpdateDayItem, onRemoveDayItem, resources, onAddResource: _onAddResource, status = 'FUTURE', dayRange, domRef }) => {

    const [isExpanded, setIsExpanded] = useState(false); // Collapsed by default

    // Effect to expand if CURRENT
    useEffect(() => {
        if (status === 'CURRENT') setIsExpanded(true);
    }, [status]);

    // Define modes if not present
    const mode = stage.mode || 'GENERIC';

    // Context Styles
    const containerClasses = status === 'PAST'
        ? 'bg-[#F5F5DC] border-stone-200 opacity-80' // Beige for Past
        : status === 'CURRENT'
            ? 'bg-white border-2 border-emerald-500 shadow-xl shadow-emerald-100 ring-4 ring-emerald-50'
            : 'bg-white border border-stone-100' // Future

    return (
        <div ref={domRef} className={`rounded-2xl overflow-hidden transition-all hover:shadow-md ${containerClasses}`}>
            {/* Header */}
            <div
                onClick={() => setIsExpanded(!isExpanded)}
                className={`p-3 cursor-pointer flex items-center justify-between transition-colors ${isExpanded ? 'bg-black/5' : 'hover:bg-black/5'}`}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-black text-[10px] ${status === 'CURRENT' ? 'bg-emerald-500 text-white' : 'bg-stone-200 text-stone-500'}`}>
                        {index + 1}
                    </div>
                    <div className="min-w-0">
                        {/* Editable Stage Name */}
                        <div onClick={(e) => e.stopPropagation()}>
                            <input
                                value={stage.name}
                                onChange={(e) => onUpdate('name', e.target.value)}
                                className={`font-bold text-sm text-stone-800 bg-transparent outline-none focus:border-b border-emerald-300 placeholder-stone-300 w-full truncate ${status === 'PAST' && 'text-stone-600 line-through decoration-stone-400'}`}
                                placeholder="Stage Name"
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider flex-shrink-0">{stage.duration} Days</span>
                            {/* Day Range Badge */}
                            {dayRange && (
                                <span className="text-[9px] font-bold text-stone-500 bg-white/50 px-1.5 py-0.5 rounded border border-stone-200 whitespace-nowrap">
                                    D{dayRange.start}-{dayRange.end}
                                </span>
                            )}
                            {/* Status Badge */}
                            {status === 'CURRENT' && (
                                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 animate-pulse border border-emerald-200 flex-shrink-0">
                                    NOW
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1.5 text-stone-300 hover:text-red-400 transition-colors">
                        <Trash2 size={14} />
                    </button>
                    {isExpanded ? <ChevronUp size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
                </div>
            </div>

            {/* EXPANDED CONTENT */}
            {isExpanded && (
                <div className="animate-in slide-in-from-top-2">
                    <div className="p-3 border-t border-stone-200/50">
                        {/* Controls Row */}
                        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 bg-white/50 p-2 rounded-xl border border-stone-200/50">
                            {/* Duration Input */}
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-stone-500">Duration:</span>
                                <div className="bg-white border border-stone-200 rounded-lg px-2 py-1 flex items-center w-16 shadow-sm">
                                    <input
                                        type="number"
                                        value={stage.duration}
                                        onChange={(e) => onUpdate('duration', parseInt(e.target.value) || 0)}
                                        className="w-full text-xs font-bold text-stone-700 outline-none bg-transparent"
                                    />
                                    <span className="text-[8px] font-bold text-stone-400 ml-1">Days</span>
                                </div>
                            </div>

                            {/* Mode Toggle */}
                            <div className="flex items-center bg-stone-200/50 p-1 rounded-lg">
                                <button
                                    onClick={() => onUpdate('mode', 'GENERIC')}
                                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all ${mode === 'GENERIC' ? 'bg-white shadow text-stone-800' : 'text-stone-400 hover:text-stone-600'}`}
                                >
                                    Generic
                                </button>
                                <button
                                    onClick={() => onUpdate('mode', 'DAY_WISE')}
                                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all ${mode === 'DAY_WISE' ? 'bg-white shadow text-stone-800' : 'text-stone-400 hover:text-stone-600'}`}
                                >
                                    Day-wise
                                </button>
                            </div>
                        </div>

                        {mode === 'GENERIC' ? (
                            /* GENERIC VIEW - Vertical Stack with Inline Suggestions */
                            <div className="flex flex-col space-y-4">
                                {/* Stage Note */}
                                <div>
                                    <label className="text-[10px] font-bold text-yellow-700 uppercase tracking-widest mb-1 block flex items-center gap-2">
                                        <AlertCircle size={10} /> Stage Notes
                                    </label>
                                    <textarea
                                        value={stage.notes || ''}
                                        onChange={(e) => onUpdate('notes', e.target.value)}
                                        className="w-full bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs font-medium text-stone-700 outline-none focus:border-yellow-400 transition-all resize-none placeholder-yellow-700/30"
                                        placeholder="Add generic instructions for this stage..."
                                        rows={2}
                                    />
                                </div>

                                <div className="flex flex-col space-y-6">
                                    {['IRRIGATION', 'NUTRITION', 'SPRAY', 'ACTIVITY'].map((type) => (
                                        <DropZone
                                            key={type}
                                            type={type}
                                            items={stage.items?.[type]}
                                            suggestions={resources.filter(r => r.type === type)}
                                            onDrop={(item) => onDropItem(type, item)}
                                            onUpdateItem={(id, field, value) => onUpdateItem(type, id, field, value)}
                                            onRemove={(id) => onRemoveItem(type, id)}
                                            onAddSuggestion={(item) => onDropItem(type, item)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            /* DAY-WISE VIEW */
                            <div className="space-y-4">
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
                                {stage.days?.map((day: any, dIdx: number) => {
                                    // Calculate Absolute Day for Display
                                    const absoluteDay = (dayRange?.start || 1) + day.day - 1;

                                    return (
                                        <div key={day.id} className="border border-stone-200 rounded-lg overflow-hidden">
                                            <div className="bg-stone-50 px-2 py-1.5 flex justify-between items-center border-b border-stone-100">
                                                <span className="text-[10px] font-black text-stone-600">Day {absoluteDay}</span>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        value={day.notes || ''}
                                                        onChange={(e) => onUpdateDay(dIdx, 'notes', e.target.value)}
                                                        className="bg-yellow-50 border border-yellow-200 rounded px-2 py-0.5 text-[10px] w-32 outline-none focus:border-yellow-400 placeholder-yellow-700/30 text-stone-700"
                                                        placeholder="Day note..."
                                                    />
                                                    <button onClick={() => onRemoveDay(day.id)} className="text-stone-300 hover:text-red-500"><Trash2 size={10} /></button>
                                                </div>
                                            </div>
                                            <div className="p-2 flex flex-col space-y-4 bg-white">
                                                {['IRRIGATION', 'NUTRITION', 'SPRAY', 'ACTIVITY'].map((type) => (
                                                    <DropZone
                                                        key={type}
                                                        type={type}
                                                        items={day.items[type]}
                                                        suggestions={resources.filter(r => r.type === type)}
                                                        onDrop={(i) => onDropDayItem(dIdx, type, i)}
                                                        onUpdateItem={(id, f, v) => onUpdateDayItem(dIdx, type, id, f, v)}
                                                        onRemove={(id) => onRemoveDayItem(dIdx, type, id)}
                                                        onAddSuggestion={(i) => onDropDayItem(dIdx, type, i)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}

                                <button
                                    onClick={onAddDay}
                                    className="w-full py-2 border-2 border-dashed border-stone-200 rounded-xl text-stone-400 font-bold text-[10px] uppercase hover:bg-stone-50 hover:border-stone-300 transition-colors flex items-center justify-center gap-2"
                                >
                                    <Plus size={12} /> Add Day Schedule
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const Step3_GrowthStages: React.FC<Step3Props> = ({ data, onUpdate, isActive, onExpand, userResources, onAddResource, currentDayNumber }) => {
    const stages = data.stages || [];
    const allResources = [...SUGGESTIONS, ...userResources];

    // Ref for Auto-Scrolling to Current Stage
    const currentStageRef = React.useRef<HTMLDivElement>(null);

    // --- EFFECT: Scroll to Current Stage ---
    useEffect(() => {
        if (isActive && currentStageRef.current) {
            console.log("Scrolling to current stage...");
            setTimeout(() => {
                currentStageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300); // Small delay to allow animation to settle
        }
    }, [isActive, currentDayNumber]);

    // --- INITIALIZATION ---
    useEffect(() => {
        if (!isActive) return;

        // 1. Auto-create if empty
        if (stages.length === 0) {
            console.log("Auto-populating stages...");
            const initialStages = DEFAULT_STAGES_CONFIG.map((conf, idx) => ({
                id: `init_stg_${idGenerator.generate()}_${idx}`,
                name: conf.name,
                duration: conf.duration,
                mode: 'GENERIC',
                items: {
                    IRRIGATION: idx === 0 ? [{ id: 'demo_ir1', text: 'Drip Irrigation', duration: '4', rate: '20', unit: 'mm', type: 'IRRIGATION' }] : [],
                    NUTRITION: [],
                    SPRAY: [],
                    ACTIVITY: []
                },
                notes: idx === 0 ? "Ensure uniform moisture distribution." : "",
                days: idx === 0 ? [
                    { id: 'd1', day: 1, notes: 'Check line pressure', items: { IRRIGATION: [], NUTRITION: [], SPRAY: [], ACTIVITY: [] } },
                    { id: 'd2', day: 2, notes: 'Inspect for leaks', items: { IRRIGATION: [], NUTRITION: [], SPRAY: [], ACTIVITY: [] } }
                ] : []
            }));
            onUpdate('stages', initialStages);
        }
        // 2. DEMO INJECTION: Ensure first stage has notes for visibility verification
        else if (stages.length > 0 && !stages[0].notes) {
            console.log("Injecting demo notes into existing stage...");
            const newStages = [...stages];
            // Deep copy first stage to avoid mutation issues before update
            const stage0 = { ...newStages[0] };
            stage0.notes = "Ensure uniform moisture distribution.";

            // Ensure days exist
            if (!stage0.days || stage0.days.length === 0) {
                stage0.days = [
                    { id: `d1_${idGenerator.generate()}`, day: 1, notes: 'Check line pressure', items: { IRRIGATION: [], NUTRITION: [], SPRAY: [], ACTIVITY: [] } },
                    { id: `d2_${idGenerator.generate()}`, day: 2, notes: 'Inspect for leaks', items: { IRRIGATION: [], NUTRITION: [], SPRAY: [], ACTIVITY: [] } }
                ];
            } else {
                // Even if days exist, inject notes into them if missing?
                 
                stage0.days = stage0.days.map((d: any, i: number) => ({
                    ...d,
                    notes: d.notes || (i === 0 ? 'Check line pressure' : i === 1 ? 'Inspect for leaks' : '')
                }));
            }
            newStages[0] = stage0;
            onUpdate('stages', newStages);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-runs when this step becomes active or `stages` change; including `onUpdate` (parent-bound callback re-created each render) would cause an infinite write loop because each call re-derives `stages` upstream.
    }, [isActive, stages]); // Re-run when active state or stages change

    // --- HANDLERS ---
    const handleCreateResource = (type: string, name: string) => {
         
        onAddResource({ id: `usr_${idGenerator.generate()}`, text: name, type: type as any, usageCount: 0 });
    };

    const handleAddStage = () => {
        const newStage = {
            id: idGenerator.generate(),
            name: `Stage ${stages.length + 1}`,
            duration: 15,
            mode: 'GENERIC',
            items: { IRRIGATION: [], NUTRITION: [], SPRAY: [], ACTIVITY: [] },
            days: []
        };
        onUpdate('stages', [...stages, newStage]);
    };

     
    const updateStage = (index: number, field: string, value: any) => {
        const newStages = [...stages];
        newStages[index][field] = value;
        onUpdate('stages', newStages);
    };

    const removeStage = (index: number) => {
         
        const newStages = stages.filter((_: any, i: number) => i !== index);
        onUpdate('stages', newStages);
    };

     
    const updateDay = (sIdx: number, dIdx: number, field: string, val: any) => {
        const newStages = [...stages];
        newStages[sIdx].days[dIdx][field] = val;
        onUpdate('stages', newStages);
    };

    // Generic Items
     
    const handleGenericDrop = (idx: number, type: string, item: any) => {
        const newStages = [...stages];
        if (!newStages[idx].items[type]) newStages[idx].items[type] = [];
        newStages[idx].items[type].push({ ...item, id: idGenerator.generate(), rate: '', unit: '' });
        onUpdate('stages', newStages);
    };

     
    const handleGenericUpdate = (idx: number, type: string, itemId: string, field: string, val: any) => {
        const newStages = [...stages];
         
        const t = newStages[idx].items[type].find((i: any) => i.id === itemId);
        if (t) t[field] = val;
        onUpdate('stages', newStages);
    };

    const handleGenericRemove = (idx: number, type: string, itemId: string) => {
        const newStages = [...stages];
         
        newStages[idx].items[type] = newStages[idx].items[type].filter((i: any) => i.id !== itemId);
        onUpdate('stages', newStages);
    };

    // Day Items
     
    const _handleAddDayToStage = (_idx: number, _type: string, _item: any) => {
        const newStages = [...stages];
        // Note: Add logic here if needed for adding days
        onUpdate('stages', newStages);
    };

    const handleAddDayToStageLogic = (idx: number) => {
        const newStages = [...stages];
        const s = newStages[idx];
        const lastDay = s.days.length > 0 ? s.days[s.days.length - 1].day : 0;
        if (lastDay >= s.duration) return;

        if (!s.days) s.days = [];
        s.days.push({
            id: idGenerator.generate(),
            day: lastDay + 1,
            items: { IRRIGATION: [], NUTRITION: [], SPRAY: [], ACTIVITY: [] }
        });
        onUpdate('stages', newStages);
    }

    const handleRemoveDayFromStage = (sIdx: number, dayId: string) => {
        const newStages = [...stages];
         
        newStages[sIdx].days = newStages[sIdx].days.filter((d: any) => d.id !== dayId);
        onUpdate('stages', newStages);
    };

     
    const handleDayDrop = (sIdx: number, dIdx: number, type: string, item: any) => {
        const newStages = [...stages];
        if (!newStages[sIdx].days[dIdx].items[type]) newStages[sIdx].days[dIdx].items[type] = [];
        newStages[sIdx].days[dIdx].items[type].push({ ...item, id: idGenerator.generate(), rate: '', unit: '' });
        onUpdate('stages', newStages);
    };

     
    const handleDayUpdate = (sIdx: number, dIdx: number, type: string, itemId: string, field: string, val: any) => {
        const newStages = [...stages];
         
        const t = newStages[sIdx].days[dIdx].items[type].find((i: any) => i.id === itemId);
        if (t) t[field] = val;
        onUpdate('stages', newStages);
    };

    const handleDayRemove = (sIdx: number, dIdx: number, type: string, itemId: string) => {
        const newStages = [...stages];
         
        newStages[sIdx].days[dIdx].items[type] = newStages[sIdx].days[dIdx].items[type].filter((i: any) => i.id !== itemId);
        onUpdate('stages', newStages);
    };


    if (!isActive) {
        return (
            <div onClick={onExpand} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm flex items-center justify-between cursor-pointer hover:border-emerald-100 transition-all group">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <CheckCircle2 size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-stone-700">{data.name || 'Growth Stages'}</h3>
                        <p className="text-xs text-stone-400 font-bold uppercase">{stages.length} Stages Defined</p>
                    </div>
                </div>
                <div className="text-sm font-bold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">Edit</div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-3xl border-2 border-emerald-50 shadow-xl shadow-emerald-50/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 relative">
            {/* Header */}
            <div className="px-8 py-6 border-b border-emerald-50 bg-emerald-50/30 flex justify-between items-center">
                <div className="flex flex-col gap-1 w-full max-w-md">
                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">SCHEDULE NAME</span>
                    <input
                        value={data.name || ''}
                        onChange={(e) => onUpdate('name', e.target.value)}
                        className="text-2xl font-black text-emerald-900 bg-transparent outline-none border-b-2 border-transparent focus:border-emerald-300 transition-all placeholder-emerald-900/30 w-full"
                        placeholder="Name your schedule..."
                    />
                </div>
                <button onClick={handleAddStage} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 active:scale-95 transition-all flex items-center gap-2">
                    <Plus size={16} /> Add Custom Stage
                </button>
            </div>

            <div className="p-4 bg-stone-50/50 min-h-[300px]">
                <div className="space-y-4">
                    {(() => {
                        let cumulativeDays = 0;
                         
                        return stages.map((stage: any, index: number) => {
                            // Calculate Display/Internal Ranges
                            const displayStart = cumulativeDays + 1;
                            const displayEnd = cumulativeDays + stage.duration;

                            const internalStart = cumulativeDays;
                            const internalEnd = cumulativeDays + stage.duration - 1; // inclusive end index for check

                            let status: 'PAST' | 'CURRENT' | 'FUTURE' = 'FUTURE';

                            if (currentDayNumber !== undefined) {
                                if (currentDayNumber > internalEnd) status = 'PAST';
                                else if (currentDayNumber >= internalStart && currentDayNumber <= internalEnd) status = 'CURRENT';
                            }

                            cumulativeDays += stage.duration;

                            return (
                                <StageCard
                                    key={stage.id}
                                    index={index}
                                    stage={stage}
                                    status={status}
                                    domRef={status === 'CURRENT' ? currentStageRef : undefined}
                                    dayRange={{ start: displayStart, end: displayEnd }}
                                    onUpdate={(f, v) => updateStage(index, f, v)}
                                    onRemove={() => removeStage(index)}
                                    // Generic
                                    onDropItem={(t, i) => handleGenericDrop(index, t, i)}
                                    onUpdateItem={(t, id, f, v) => handleGenericUpdate(index, t, id, f, v)}
                                    onRemoveItem={(t, id) => handleGenericRemove(index, t, id)}
                                    onUpdateDay={(dIdx, f, v) => updateDay(index, dIdx, f, v)}
                                    // Day
                                    onAddDay={() => handleAddDayToStageLogic(index)}
                                    onRemoveDay={(id) => handleRemoveDayFromStage(index, id)}
                                    onDropDayItem={(d, t, i) => handleDayDrop(index, d, t, i)}
                                    onUpdateDayItem={(d, t, id, f, v) => handleDayUpdate(index, d, t, id, f, v)}
                                    onRemoveDayItem={(d, t, id) => handleDayRemove(index, d, t, id)}
                                    // Resources
                                    resources={allResources}
                                    onAddResource={handleCreateResource}
                                />
                            );
                        });
                    })()}
                </div>

                {stages.length === 0 && (
                    <div className="text-center py-12">
                        <p className="text-stone-400 font-bold">Initializing default stages...</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Step3_GrowthStages;
