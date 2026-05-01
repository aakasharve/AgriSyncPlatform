/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ActivityCard from '../../ActivityCard';
import {
    CropActivityEvent, IrrigationEvent, LabourEvent, MachineryEvent,
    LedgerDefaults, FarmerProfile, CropProfile, InputEvent, Plot,
    ActivityExpenseEvent, ObservationNote, PlannedTask, DailyLog, DisturbanceEvent
} from '../../../../../types';
import { BucketIssue } from '../../../../../domain/types/log.types';
import { SAFE_DEFAULTS } from '../types';

interface ActivityLedgerProps {
    selectedLogId: string | null;
    cropActivities: CropActivityEvent[];
    labourMap: Record<string, LabourEvent>;
    irrigationMap: Record<string, IrrigationEvent>;
    machineryMap: Record<string, MachineryEvent>;
    inputMap: Record<string, InputEvent[]>;
    expenses: ActivityExpenseEvent[];
    observations: ObservationNote[];
    plannedTasks: PlannedTask[];
    disturbance: DisturbanceEvent | undefined;
    crops: CropProfile[];
    todayLogs: DailyLog[];
    profile: FarmerProfile;
    activePlot: Plot | undefined;
    activeCrop: CropProfile | undefined;
    defaults?: LedgerDefaults;
    setExpenses: React.Dispatch<React.SetStateAction<ActivityExpenseEvent[]>>;
    setObservations: React.Dispatch<React.SetStateAction<ObservationNote[]>>;
    onUpdateDetails: (activityId: string, type: 'labour' | 'irrigation' | 'machinery' | 'input', data: any) => void;
    onDeleteActivity: (id: string) => void;
    onUpdateWorkTypes: (activityId: string, types: string[]) => void;
    onRefineWorkType: (oldType: string, newType: string, mode: 'manual' | 'voice') => void;
    onUpdateIssue: (activityId: string, issue: BucketIssue | undefined) => void;
}

const ActivityLedger: React.FC<ActivityLedgerProps> = ({
    selectedLogId,
    cropActivities,
    labourMap,
    irrigationMap,
    machineryMap,
    inputMap,
    expenses,
    observations,
    plannedTasks,
    disturbance,
    crops,
    todayLogs,
    profile,
    activePlot,
    activeCrop,
    defaults,
    setExpenses,
    setObservations,
    onUpdateDetails,
    onDeleteActivity,
    onUpdateWorkTypes,
    onRefineWorkType,
    onUpdateIssue,
}) => {
    return (
        <div className={`space-y-4 min-h-[200px] border-l-2 pl-4 transition-colors ${selectedLogId ? 'border-amber-200' : 'border-emerald-100/50'}`}>


            {cropActivities.length === 0 ? (
                <div className="border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center bg-stone-50/50">
                    <p className="text-stone-400 font-bold">No activities logged today</p>
                    <p className="text-xs text-stone-300 mt-1">Select above or type to add</p>
                </div>
            ) : (
                cropActivities.map(act => (
                    <ActivityCard
                        key={act.id}
                        activity={act}
                        linkedData={{
                            labour: labourMap[act.id],
                            irrigation: irrigationMap[act.id],
                            machinery: machineryMap[act.id],
                        }}
                        inputs={inputMap[act.id] || []}
                        onUpdateDetails={(type, data) => onUpdateDetails(act.id, type, data)}
                        onDeleteActivity={() => onDeleteActivity(act.id)}
                        onUpdateWorkTypes={(types) => onUpdateWorkTypes(act.id, types)}
                        defaults={defaults || SAFE_DEFAULTS}
                        profile={profile}
                        currentPlot={activePlot}
                        cropContractUnit={activeCrop?.contractUnitDefault}
                        expenses={expenses.filter(e => e.linkedActivityId === act.id)} // Pass linked expenses
                        onAddExpense={(data) => {
                            const newExp = { ...data, linkedActivityId: act.id };
                            setExpenses([...expenses, newExp]);
                        }}
                        onUpdateExpenses={(updatedExp) => {
                            setExpenses(expenses.map(e => e.id === updatedExp.id ? updatedExp : e));
                        }}
                        onDeleteExpense={(expId) => {
                            setExpenses(expenses.filter(e => e.id !== expId));
                        }}
                        plannedTasks={plannedTasks} // Sync global tasks to card buckets
                        observations={observations} // Pass all observations
                        draftDisturbance={disturbance}
                        crops={crops} // Pass crops for HubSheet context
                        onAddObservation={(note) => setObservations([...observations, note])}
                        todayLogs={todayLogs} // Pass full log objects for aggregation
                        onRefineWorkType={onRefineWorkType}
                        onUpdateIssue={(issue) => onUpdateIssue(act.id, issue)}
                    />
                ))
            )}
        </div>
    );
};

export default ActivityLedger;
