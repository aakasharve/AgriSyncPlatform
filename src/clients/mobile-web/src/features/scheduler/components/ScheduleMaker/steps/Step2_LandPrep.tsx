import React from 'react';
import { Calendar, ChevronUp, ChevronDown, Trash2, Clock, CheckCircle2 } from 'lucide-react';
import DraggableTray from '../DraggableTray';
import { idGenerator } from '../../../../../core/domain/services/IdGenerator';

interface Step2Props {
    data: any;
    onUpdate: (field: string, value: any) => void;
    isActive: boolean;
    onExpand: () => void;
}

// Mock Suggestions
const SUGGESTIONS = [
    { id: 'sa1', text: 'Deep Ploughing', type: 'ACTIVITY' },
    { id: 'sa2', text: 'Rotavator', type: 'ACTIVITY' },
    { id: 'sa3', text: 'FYM Application', type: 'NUTRITION' },
    { id: 'sa4', text: 'Bed Preparation', type: 'ACTIVITY' },
    { id: 'sa5', text: 'Drip Installation', type: 'ACTIVITY' },
    { id: 'sa6', text: 'Pre-emergence Herbicide', type: 'SPRAY' },
];

const Step2_LandPrep: React.FC<Step2Props> = ({ data, onUpdate, isActive, onExpand }) => {
    const activities = data.prepActivities || [];
    const duration = data.landPrepDuration || 15;

    const handleDurationChange = (delta: number) => {
        const newVal = Math.max(0, duration + delta);
        onUpdate('landPrepDuration', newVal);
    };

    const handleAddActivity = (item: any) => {
        const newActivity = { ...item, id: idGenerator.generate(), notes: '' };
        onUpdate('prepActivities', [...activities, newActivity]);
    };

    const handleRemoveActivity = (id: string) => {
        onUpdate('prepActivities', activities.filter((a: any) => a.id !== id));
    };

    // Minimized View
    if (!isActive) {
        return (
            <div onClick={onExpand} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm flex items-center justify-between cursor-pointer hover:border-indigo-100 transition-all group">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <CheckCircle2 size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-stone-700">Land Preparation</h3>
                        <p className="text-xs text-stone-400 font-bold uppercase">{duration} Days • {activities.length} Activities</p>
                    </div>
                </div>
                <div className="text-sm font-bold text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">Edit</div>
            </div>
        );
    }

    // Active View
    return (
        <div className="bg-white rounded-3xl border-2 border-indigo-50 shadow-xl shadow-indigo-50/50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
            {/* Header */}
            <div className="px-8 py-6 border-b border-indigo-50 bg-indigo-50/30 flex justify-between items-start">
                <div>
                    <h3 className="text-xl font-black text-indigo-900">Land Preparation</h3>
                    <p className="text-stone-500 text-sm font-medium">Define the schedule before sowing.</p>
                </div>
                <div className="flex items-center gap-2 bg-white rounded-xl p-1 shadow-sm border border-indigo-100">
                    <button onClick={() => handleDurationChange(-1)} className="p-2 hover:bg-stone-50 rounded-lg text-stone-400 hover:text-stone-800 transition-colors"><ChevronDown size={16} /></button>
                    <div className="text-center w-12">
                        <div className="font-black text-lg text-stone-800 leading-none">{duration}</div>
                        <div className="text-[8px] font-bold text-stone-400 uppercase">Days</div>
                    </div>
                    <button onClick={() => handleDurationChange(1)} className="p-2 hover:bg-stone-50 rounded-lg text-stone-400 hover:text-stone-800 transition-colors"><ChevronUp size={16} /></button>
                </div>
            </div>

            {/* Drop Zone / Timeline */}
            <div
                className="p-8 min-h-[300px] bg-stone-50/30"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-indigo-50/50'); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('bg-indigo-50/50'); }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('bg-indigo-50/50');
                    const dataStr = e.dataTransfer.getData('application/json');
                    if (dataStr) {
                        const item = JSON.parse(dataStr);
                        handleAddActivity(item);
                    }
                }}
            >
                {/* Timeline Line */}
                <div className="relative pl-8 border-l-2 border-dashed border-stone-200 space-y-6">
                    {activities.length === 0 && (
                        <div className="absolute top-0 left-8 right-0 bottom-0 flex flex-col items-center justify-center text-stone-300 pointer-events-none">
                            <Clock size={48} className="mb-2 opacity-50" />
                            <span className="font-bold">Drag activities here from the tray below</span>
                        </div>
                    )}

                    {activities.map((act: any, idx: number) => (
                        <div key={act.id} className="relative group">
                            {/* Node Dot */}
                            <div className="absolute -left-[41px] top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-4 border-stone-200 group-hover:border-indigo-400 transition-colors" />

                            {/* Card */}
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 group-hover:border-indigo-200 transition-all flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="font-bold text-stone-700">{act.text}</div>
                                    <div className="text-[10px] font-bold text-stone-400 uppercase">{act.type}</div>
                                    <input
                                        className="w-full mt-2 text-xs bg-transparent border-b border-stone-100 focus:border-indigo-200 outline-none transition-colors"
                                        placeholder="Add notes..."
                                        value={act.notes}
                                        onChange={(e) => {
                                            const newActs = [...activities];
                                            newActs[idx].notes = e.target.value;
                                            onUpdate('prepActivities', newActs);
                                        }}
                                    />
                                </div>
                                <button onClick={() => handleRemoveActivity(act.id)} className="text-stone-300 hover:text-red-400"><Trash2 size={16} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tray embedded inside */}
            <div className="bg-stone-50 border-t border-stone-100">
                <DraggableTray items={SUGGESTIONS} title="Prep Suggestions" />
            </div>
        </div>
    );
};

export default Step2_LandPrep;
