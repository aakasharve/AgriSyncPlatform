import React from 'react';
import { CheckCircle, Calendar, MapPin, Layers } from 'lucide-react';

interface Step4Props {
    data: any;
}

const Step4_Review: React.FC<Step4Props> = ({ data }) => {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
            <div className="text-center mb-10">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-100">
                    <CheckCircle size={32} />
                </div>
                <h3 className="text-2xl font-black text-stone-800">Ready to Create Schedule</h3>
                <p className="text-stone-500">Review your plan details below before finalizing.</p>
            </div>

            <div className="grid grid-cols-2 gap-6 max-w-2xl mx-auto">
                {/* Card 1: Crop Details */}
                <div className="bg-stone-50 p-6 rounded-2xl border border-stone-200">
                    <h5 className="text-[10px] uppercase font-bold text-stone-400 mb-4 flex items-center gap-2">
                        <MapPin size={12} /> Target
                    </h5>
                    <div className="space-y-1">
                        <div className="text-sm font-bold text-stone-500">Crop Profile</div>
                        <div className="text-lg font-black text-stone-800">{data.cropProfile?.name || data.cropId || 'Not Selected'}</div>
                    </div>
                    <div className="mt-4 space-y-1">
                        <div className="text-sm font-bold text-stone-500">Plot</div>
                        <div className="text-lg font-black text-stone-800">{data.plotId || 'Not Selected'}</div>
                    </div>
                </div>

                {/* Card 2: Timing */}
                <div className="bg-stone-50 p-6 rounded-2xl border border-stone-200">
                    <h5 className="text-[10px] uppercase font-bold text-stone-400 mb-4 flex items-center gap-2">
                        <Calendar size={12} /> Timeline
                    </h5>
                    <div className="space-y-1">
                        <div className="text-sm font-bold text-stone-500">Day 1 (Planting)</div>
                        <div className="text-lg font-black text-stone-800">{data.plantationDate}</div>
                    </div>
                    <div className="mt-4 space-y-1">
                        <div className="text-sm font-bold text-stone-500">Land Prep Start</div>
                        <div className="text-lg font-black text-stone-800">
                            {/* Simple calc for display */}
                            Calculated (-{data.landPrepDuration} days)
                        </div>
                    </div>
                </div>

                {/* Card 3: Composition */}
                <div className="col-span-2 bg-stone-50 p-6 rounded-2xl border border-stone-200 flex items-center justify-between">
                    <div>
                        <h5 className="text-[10px] uppercase font-bold text-stone-400 mb-2 flex items-center gap-2">
                            <Layers size={12} /> Structure
                        </h5>
                        <div className="text-3xl font-black text-stone-800">{data.stages?.length || 0}</div>
                        <div className="text-sm font-bold text-stone-500">Growth Stages Defined</div>
                    </div>
                    <div className="h-12 w-px bg-stone-200 mx-6" />
                    <div className="flex-1">
                        <div className="text-xs font-bold text-stone-500 mb-2">Includes:</div>
                        <div className="flex gap-2">
                            <span className="px-2 py-1 bg-white border border-stone-200 rounded text-[10px] font-bold text-stone-600">
                                {data.prepActivities?.length || 0} Prep Activities
                            </span>
                            <span className="px-2 py-1 bg-white border border-stone-200 rounded text-[10px] font-bold text-stone-600">
                                {data.stages?.reduce((acc: any, s: any) => acc + s.items.NUTRITION.length + s.items.SPRAY.length + s.items.ACTIVITY.length, 0)} Stage Activities
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Step4_Review;
