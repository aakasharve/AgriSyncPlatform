/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { ActivityExpenseEvent, DailyLog } from '../../../../types';
import { AlertTriangle, Check, FlaskConical, ListPlus, MessageSquare, Mic, PenLine, Tractor, Users, Droplets, Bell, Wrench, Zap, Cloud, X } from 'lucide-react';
import TrustBadge from '../../../../shared/components/ui/TrustBadge';
import ObservationHubSheet from '../ObservationHubSheet';
import { BucketIssue } from '../../../../domain/types/log.types';
import { buildWorkDoneTitles } from '../../services/workDoneProjection';
import { isCompletedIrrigationEvent } from '../../services/irrigationCompletion';
import { ActivityCardProps } from './ActivityCardProps';
import BucketItem from './components/BucketItem';
import InputDetailSheet from './sheets/InputDetailSheet';
import ExpenseDetailSheet from './sheets/ExpenseDetailSheet';
import DetailSheet from './sheets/DetailSheet';
import WorkDetailSheet from './sheets/WorkDetailSheet';

const ActivityCard: React.FC<ActivityCardProps> = ({
    activity,
    linkedData,
    inputs,
    onUpdateDetails,
    onUpdateWorkTypes,
    onRefineWorkType,
    onDeleteActivity: _onDeleteActivity,
    defaults,
    profile,
    currentPlot,
    cropContractUnit,
    expenses: rawExpenses = [],
    onAddExpense,
    onUpdateExpenses,
    onDeleteExpense,
    observations = [],
    onAddObservation,
    draftDisturbance,
    crops = [],
    plannedTasks = [],
    verificationStatus,
    onUpdateIssue, // NEW: Prop to update main activity issue
    todayLogs = [] // NEW: Destructure todayLogs with default
}: ActivityCardProps & { onUpdateIssue?: (issue: BucketIssue | undefined) => void }) => {
    const [refiningItem, setRefiningItem] = useState<{ name: string; mode: 'manual' | 'voice' } | null>(null);
    const expenses = rawExpenses.map((expense) => ({
        ...expense,
        totalAmount: expense.totalAmount ?? 0,
    }));
    const [refineValue, setRefineValue] = useState('');
    // ActivityCard Props Update: onRename removed, onUpdateWorkTypes added.

    // --- AGGREGATION HELPERS (Today's Cumulative) ---
    const getPlotTodayLogs = () => {
        if (!currentPlot || !todayLogs.length) return [];
        return todayLogs.filter(log =>
            log.context.selection.some(sel => sel.selectedPlotIds.includes(currentPlot.id))
        );
    };

    const plotTodayLogs = getPlotTodayLogs();

    const getDailyLabourTotal = () => {
        let totalWorkers = 0;
        let totalCost = 0;
        plotTodayLogs.forEach(l => {
            l.labour.forEach(lab => {
                totalWorkers += (lab.count || 0);
                totalCost += (lab.totalCost || 0);
            });
        });
        return { totalWorkers, totalCost };
    };

    const getDailyIrrigationTotal = () => {
        let hours = 0;
        plotTodayLogs.forEach(l => {
            l.irrigation.forEach(irr => {
                hours += (irr.durationHours || 0);
            });
        });
        return hours;
    };

    const getDailyMachineryTotal = () => {
        let hours = 0;
        plotTodayLogs.forEach(l => {
            l.machinery.forEach(m => {
                hours += (m.hoursUsed || 0);
            });
        });
        return hours;
    };

    const getDailyInputsTotal = () => {
        const productSet = new Set<string>();
        plotTodayLogs.forEach(l => {
            l.inputs.forEach(inp => {
                inp.mix?.forEach(m => {
                    if (m.productName) productSet.add(m.productName);
                });
            });
        });
        return productSet.size;
    };

    const getDailyExpenseTotal = () => {
        return plotTodayLogs.reduce((acc, l) => acc + (l.activityExpenses?.reduce((sum, e) => sum + (e.totalAmount ?? 0), 0) || 0), 0);
    };

    const getDailyWorkList = () => {
        return buildWorkDoneTitles([
            ...plotTodayLogs,
            {
                cropActivities: [activity],
                irrigation: linkedData.irrigation ? [linkedData.irrigation] : [],
                labour: linkedData.labour ? [linkedData.labour] : [],
                inputs,
                machinery: linkedData.machinery ? [linkedData.machinery] : [],
                activityExpenses: expenses,
            },
        ]);
    };

    // State for Sheets
    const [activeSheet, setActiveSheet] = useState<'work' | 'labour' | 'irrigation' | 'machinery' | 'input' | 'expense' | 'observation' | 'reminder' | 'disturbance' | null>(null);
    const [editingExpense, setEditingExpense] = useState<ActivityExpenseEvent | undefined>(undefined);

    // Aggregation-Aware Filled States
    const dailyLabour = getDailyLabourTotal();
    const _dailyIrrigationHours = getDailyIrrigationTotal();
    const _dailyMachineryHours = getDailyMachineryTotal();
    const dailyInputCount = getDailyInputsTotal();
    const dailyExpenseTotal = getDailyExpenseTotal();
    const dailyIrrigation = getDailyIrrigationTotal();

    const isLabourFilled = !!linkedData.labour || dailyLabour.totalWorkers > 0;
    const isLabourIssue = !!linkedData.labour?.issue;

    const isLinkedIrrigationCompleted = linkedData.irrigation
        ? isCompletedIrrigationEvent(linkedData.irrigation)
        : false;
    const isIrrigationFilled = isLinkedIrrigationCompleted || dailyIrrigation > 0;
    const isIrrigationIssue = isLinkedIrrigationCompleted && !!linkedData.irrigation?.issue;
    const isMachineryFilled = !!linkedData.machinery;
    const isMachineryIssue = !!linkedData.machinery?.issue;

    const isInputsFilled = inputs.length > 0 || dailyInputCount > 0;
    const isExpensesFilled = (expenses && expenses.length > 0) || dailyExpenseTotal > 0;

    // NEW: Observation vs Reminder Distinction
    const reminderNotes = observations.filter(o => o.noteType === 'reminder');
    const generalNotes = observations.filter(o => o.noteType !== 'reminder');

    const isRemindersFilled = (plannedTasks && plannedTasks.length > 0) || (reminderNotes.length > 0);
    const isObservationsFilled = generalNotes.length > 0;

    // NEW: Work Done is Global if any sub-bucket is filled (EXCLUDING reminders, which are future)
    const isAnySubBucketFilled = isLabourFilled || isIrrigationFilled || isMachineryFilled || isInputsFilled || isExpensesFilled;
    const isWorkFilled = (activity.workTypes && activity.workTypes.length > 0) || isAnySubBucketFilled;

    // Helper to format Labour Chip label
    const getLabourLabel = () => {
        const l = linkedData.labour;
        if (!l) return undefined; // Let component handle "Add details..."
        if (l.type === 'SELF') return 'Self • Family Labour';
        if (l.type === 'CONTRACT') return `Contract • ${l.contractQuantity} ${l.contractUnit} • ₹${l.totalCost}`;

        // HIRED: "2M + 4F • ₹1200"
        const parts = [];
        if (l.maleCount) parts.push(`${l.maleCount}M`);
        if (l.femaleCount) parts.push(`${l.femaleCount}F`);
        const workers = parts.join(' + ') || `${l.count} Workers`;
        return `${workers} • ₹${l.totalCost}`;
    };

    // Helper for Work Done Sublabel (Global Summary)
    const getWorkDoneSublabel = () => {
        const dailyTypes = getDailyWorkList();
        if (dailyTypes.length > 0) return dailyTypes.join(', ');

        // Fallback: If AI gave a specific title but no workTypes array
        if (activity.title && !['Crop Activity', 'Log Entry', 'Field Work'].includes(activity.title)) {
            return activity.title;
        }

        return undefined;
    };

    // Helper for Inputs Label
    const getInputLabel = () => {
        if (!inputs || inputs.length === 0) return undefined;
        const main = inputs[0];

        // Try to show Product Names first
        const productNames = main.mix?.map(m => m.productName).filter(Boolean).slice(0, 2).join(', ');
        const extraCount = (main.mix?.length || 0) - 2;
        const products = productNames ? (extraCount > 0 ? `${productNames} +${extraCount}` : productNames) : `${main.mix?.length} Items`;

        // Method Suffix
        const method = main.method === 'Spray' ? (main.carrierType === 'Blower' ? 'Blower' : 'Spray') : main.method;

        return `${products} • ${method}`;
    };

    return (
        <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl shadow-slate-200/60 p-5 animate-in fade-in slide-in-from-bottom-4 ring-1 ring-slate-100/50">
            {/* Ambient Backlight for 3D depth */}
            <div className="absolute -inset-1 bg-gradient-to-b from-slate-50 to-transparent rounded-3xl -z-10 opacity-50" />

            <div className="flex justify-between items-start mb-3">
                <div className="flex-1 mr-2">
                    <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-2">
                            <h4 className="text-lg font-bold text-slate-800 leading-tight">
                                {activity.title === 'Crop Activity' && activity.workTypes && activity.workTypes.length > 0
                                    ? activity.workTypes[0]
                                    : activity.title
                                }
                            </h4>
                            {verificationStatus && <TrustBadge status={verificationStatus} size="sm" />}
                        </div>
                        {/* No Rename or Common Activity Badge needed for Global Card really,
                            but kept structure if we ever need it.
                            The title is now "Log of 18 Jan 2026" fixed by ManualEntry.
                        */}
                    </div>
                </div>
                {/*
                <button onClick={onDeleteActivity} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                    <Trash2 size={18} />
                </button>
                Global card probably shouldn't be deleted easily? Or maybe yes to reset?
                Keeping delete for now.
                */}
            </div>

            {/* Buckets List (Vertical) */}
            <div className="space-y-3 mb-2 mt-4 px-1">
                {/* 1. Work Bucket */}
                <div className="space-y-4">
                    <BucketItem
                        icon={<ListPlus />}
                        label="Work Done"
                        sublabel={getWorkDoneSublabel()}
                        filled={isWorkFilled}
                        theme="emerald"
                        onClick={() => setActiveSheet('work')}
                        hasIssue={!!activity.issue} // Show badge if activity has an issue
                    // Transparency removed from here to move it below the list
                    />

                    {/* In-Card Work Type List (Visual Confirmation) - moved JUST BELOW bucket */}
                    {isWorkFilled && (
                        <div className="mt-[-8px] space-y-2 mb-1 px-1">
                            {(() => {
                                const types = getDailyWorkList();
                                if (types.length === 0 && activity.title && !['Crop Activity', 'Log Entry', 'Field Work'].includes(activity.title)) {
                                    types.push(activity.title);
                                }
                                return types.map((w, idx) => {
                                    const isRefining = refiningItem?.name === w;
                                    return (
                                        <div key={idx} className="group flex justify-between items-center p-2.5 bg-emerald-50/50 rounded-xl border border-emerald-100 text-xs text-emerald-800 shadow-sm transition-all hover:bg-emerald-50 active:scale-[0.98]">
                                            <div className="flex items-center gap-2 flex-1">
                                                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white flex-shrink-0">
                                                    <Check size={12} strokeWidth={3} />
                                                </div>
                                                {isRefining && refiningItem.mode === 'manual' ? (
                                                    <input
                                                        autoFocus
                                                        value={refineValue}
                                                        onChange={e => setRefineValue(e.target.value)}
                                                        onBlur={() => {
                                                            if (refineValue.trim() && refineValue !== w) {
                                                                onRefineWorkType?.(w, refineValue.trim(), 'manual');
                                                            }
                                                            setRefiningItem(null);
                                                        }}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                if (refineValue.trim() && refineValue !== w) {
                                                                    onRefineWorkType?.(w, refineValue.trim(), 'manual');
                                                                }
                                                                setRefiningItem(null);
                                                            }
                                                            if (e.key === 'Escape') setRefiningItem(null);
                                                        }}
                                                        className="bg-white/80 border-none outline-none font-bold text-emerald-900 uppercase tracking-wide px-1 rounded flex-1"
                                                    />
                                                ) : (
                                                    <span className={`font-bold text-emerald-900 leading-tight uppercase tracking-wide ${isRefining ? 'animate-pulse text-emerald-500' : ''}`}>
                                                        {isRefining && refiningItem.mode === 'voice' ? 'Listening...' : w}
                                                    </span>
                                                )}
                                            </div>

                                            {!isRefining && (
                                                <div className="flex items-center gap-1 opacity-30 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => {
                                                            setRefiningItem({ name: w, mode: 'voice' });
                                                            // For now, simple simulation of calling a mic - in real app, triggers global record
                                                            onRefineWorkType?.(w, '', 'voice');
                                                        }}
                                                        className="p-1.5 hover:bg-emerald-100 rounded-lg text-emerald-400 hover:text-emerald-600 transition-colors"
                                                        title="Speak to refine"
                                                    >
                                                        <Mic size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setRefiningItem({ name: w, mode: 'manual' });
                                                            setRefineValue(w);
                                                        }}
                                                        className="p-1.5 hover:bg-emerald-100 rounded-lg text-emerald-400 hover:text-emerald-600 transition-colors"
                                                        title="Edit name"
                                                    >
                                                        <PenLine size={14} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    )}

                    {/* Transparency Block - moved to BOTTOM of the work section */}
                    {isWorkFilled && (activity.sourceText || activity.systemInterpretation) && (
                        <div className="mt-2 pt-3 border-t border-slate-100/50 px-1">
                            {activity.sourceText && (
                                <div className="flex items-start gap-2 mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5 whitespace-nowrap">YOU SAID:</span>
                                    <p className="text-xs font-medium text-slate-600 italic">"{activity.sourceText}"</p>
                                </div>
                            )}
                            {activity.systemInterpretation && (
                                <div className="flex items-start gap-2 bg-emerald-100/30 p-2.5 rounded-xl border border-emerald-50 border-l-4 border-l-emerald-400">
                                    <div className="mt-1 text-emerald-500">
                                        <Zap size={10} fill="currentColor" />
                                    </div>
                                    <p className="text-[11px] font-medium text-emerald-800 leading-relaxed italic">
                                        {activity.systemInterpretation}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 2. Labour Bucket */}
                <BucketItem
                    icon={<Users />}
                    label="Labour & Wages"
                    sublabel={(() => {
                        const daily = getDailyLabourTotal();
                        if (isLabourFilled) return getLabourLabel();
                        if (daily.totalWorkers > 0) return `Today: ${daily.totalWorkers} Staff (Logged)`;
                        return undefined;
                    })()}
                    filled={isLabourFilled}
                    theme="orange"
                    onClick={() => setActiveSheet('labour')}
                    sourceText={linkedData.labour?.sourceText}
                    systemInterpretation={linkedData.labour?.systemInterpretation}
                    hasIssue={isLabourIssue}
                />

                {/* 3. Inputs Bucket */}
                <BucketItem
                    icon={<FlaskConical />}
                    label="Inputs & Protection"
                    sublabel={(() => {
                        const dailyCount = getDailyInputsTotal();
                        if (isInputsFilled) return getInputLabel();
                        if (dailyCount > 0) return `Today: ${dailyCount} Item(s) applied`;
                        return undefined;
                    })()}
                    filled={isInputsFilled}
                    theme="purple"
                    onClick={() => setActiveSheet('input')}
                    sourceText={inputs.find(i => i.sourceText)?.sourceText}
                    systemInterpretation={inputs.find(i => i.systemInterpretation)?.systemInterpretation}
                />

                {/* 4. Irrigation Bucket */}
                <BucketItem
                    icon={isIrrigationIssue ? <AlertTriangle /> : <Droplets />}
                    label="Irrigation"
                    sublabel={(() => {
                        const dailyHours = getDailyIrrigationTotal();
                        if (isIrrigationFilled && !isLinkedIrrigationCompleted) return `Today: ${dailyHours}h Total Run`;
                        if (isIrrigationIssue) return linkedData.irrigation?.issue?.reason || 'Issue Logged';
                        if (isIrrigationFilled) return `${linkedData.irrigation?.durationHours}h ${linkedData.irrigation?.method} • ${linkedData.irrigation?.source}`;
                        if (dailyHours > 0) return `Today: ${dailyHours}h Total Run`;
                        return undefined;
                    })()}
                    filled={isIrrigationFilled}
                    theme={isIrrigationIssue ? "amber" : "blue"}
                    onClick={() => setActiveSheet('irrigation')}
                    sourceText={linkedData.irrigation?.sourceText}
                    systemInterpretation={linkedData.irrigation?.systemInterpretation}
                    hasIssue={isIrrigationIssue}
                />

                {/* 5. Machinery Bucket */}
                <BucketItem
                    icon={<Tractor />}
                    label="Machinery"
                    sublabel={(() => {
                        const dailyHours = getDailyMachineryTotal();
                        if (isMachineryFilled) return `${linkedData.machinery?.type} • ${linkedData.machinery?.hoursUsed}h`;
                        if (dailyHours > 0) return `Today: ${dailyHours}h Machine Work`;
                        return undefined;
                    })()}
                    filled={isMachineryFilled}
                    theme="indigo"
                    onClick={() => setActiveSheet('machinery')}
                    sourceText={linkedData.machinery?.sourceText}
                    systemInterpretation={linkedData.machinery?.systemInterpretation}
                    hasIssue={isMachineryIssue}
                />

                {/* 6. Expenses Bucket */}
                <BucketItem
                    icon={<img src="/assets/rupee_black.png" alt="Expense" className="w-5 h-5 opacity-80" />}
                    label="Expenses"
                    sublabel={(() => {
                        const dailyTotal = getDailyExpenseTotal();
                        if (isExpensesFilled) return `₹${expenses.reduce((s, e) => s + e.totalAmount, 0)} Total`;
                        if (dailyTotal > 0) return `Today: ₹${dailyTotal} Total Expenses`;
                        return undefined;
                    })()}
                    filled={isExpensesFilled}
                    theme="rose"
                    onClick={() => { setEditingExpense(undefined); setActiveSheet('expense'); }}
                    sourceText={expenses.find(e => e.sourceText)?.sourceText}
                    systemInterpretation={expenses.find(e => e.systemInterpretation)?.systemInterpretation}
                />

                <BucketItem
                    icon={<MessageSquare />}
                    label="Observations / Notes"
                    sublabel={isObservationsFilled ? `${generalNotes.length} Note(s)` : undefined}
                    filled={isObservationsFilled}
                    theme="emerald"
                    onClick={() => setActiveSheet('observation')}
                    sourceText={observations.find(o => o.sourceText)?.sourceText}
                    systemInterpretation={observations.find(o => o.systemInterpretation)?.systemInterpretation}
                />

                {/* 7.5 Issues & Blockers Bucket (NEW) */}
                {(draftDisturbance || (todayLogs && todayLogs.length > 0)) && (() => {
                    const disturbance = draftDisturbance || todayLogs.find(log => log.disturbance)?.disturbance;
                    const hasDisturbance = Boolean(disturbance);

                    if (!hasDisturbance) return null;

                    const getDisturbanceIcon = (group: string = '') => {
                        if (group.toLowerCase().includes('machinery')) return <Wrench size={16} />;
                        if (group.toLowerCase().includes('electricity') || group.toLowerCase().includes('power')) return <Zap size={16} />;
                        if (group.toLowerCase().includes('weather') || group.toLowerCase().includes('rain')) return <Cloud size={16} />;
                        return <AlertTriangle size={16} />;
                    };

                    const getTheme = (scope: string = 'PARTIAL') => {
                        if (scope === 'FULL_DAY') return 'rose';
                        return 'amber';
                    };

                    return (
                        <BucketItem
                            icon={getDisturbanceIcon(disturbance?.group)}
                            label="Issues & Blockers"
                            sublabel={disturbance?.reason || `${disturbance?.group} Issue`}
                            filled={true}
                            theme={getTheme(disturbance?.scope)}
                            onClick={() => setActiveSheet('disturbance')}
                            sourceText={disturbance?.sourceText}
                            systemInterpretation={disturbance?.systemInterpretation}
                        />
                    );
                })()}

                {/* 8. Reminders Bucket */}
                <BucketItem
                    icon={<Bell />}
                    label="Reminders"
                    sublabel={isRemindersFilled ? (() => {
                        const all = [...(plannedTasks || []), ...reminderNotes];
                        const unique = all.filter((item, index) => {
                            const text = 'title' in item ? item.title : item.textRaw;
                            return all.findIndex(i => ('title' in i ? i.title : i.textRaw) === text) === index;
                        });
                        return `${unique.length} ITEM(S)`;
                    })() : undefined}
                    filled={isRemindersFilled}
                    theme="indigo"
                    onClick={() => setActiveSheet('reminder')}
                    sourceText={plannedTasks.find(t => t.sourceText)?.sourceText || reminderNotes.find(n => n.sourceText)?.sourceText}
                    systemInterpretation={plannedTasks.find(t => t.systemInterpretation)?.systemInterpretation || reminderNotes.find(n => n.systemInterpretation)?.systemInterpretation}
                />
            </div>


            {/* EXPENSE LIST (Micro-View inside Card) */}
            {isExpensesFilled && (
                <div className="mt-2 space-y-2 mb-3">
                    {expenses.map(exp => (
                        <div key={exp.id} className="flex justify-between items-center p-2 bg-rose-50/50 rounded-lg border border-rose-100 text-xs text-rose-800">
                            <div className="flex items-center gap-2">
                                <span className="font-bold">{exp.reason}</span>
                                {exp.notes && <span className="text-rose-400 truncate max-w-[100px]">- {exp.notes}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="font-bold">₹{exp.totalAmount}</span>
                                <button onClick={() => onDeleteExpense?.(exp.id)} className="text-rose-300 hover:text-rose-500"><X size={14} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* REMINDERS LIST (Micro-View inside Card) */}
            {isRemindersFilled && (
                <div className="mt-2 space-y-2 mb-3">
                    <h5 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest px-1 italic">PLANNED REMINDERS</h5>
                    {(() => {
                        const all = [...(plannedTasks || []), ...reminderNotes];
                        // Deduplicate by text/title
                        const unique = all.filter((item, index) => {
                            const text = 'title' in item ? item.title : item.textRaw;
                            return all.findIndex(i => ('title' in i ? i.title : i.textRaw) === text) === index;
                        });

                        return unique.map((item, idx) => (
                            <div key={'id' in item ? item.id : idx} className="flex justify-between items-center p-2 bg-indigo-50/50 rounded-lg border border-indigo-100 text-xs text-indigo-800">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                                    <span className="font-medium text-indigo-900 leading-tight">{'title' in item ? item.title : item.textRaw}</span>
                                </div>
                                <button className="text-indigo-300 hover:text-indigo-500" onClick={() => {/* Delete logic if added */ }}><X size={14} /></button>
                            </div>
                        ));
                    })()}
                </div>
            )}

            {/* Outcome / Notes Input (AT THE BOTTOM) */}
            <div className="relative mt-4">
                <PenLine size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
                <input
                    type="text"
                    placeholder="Outcome (e.g. 5 rows done)"
                    className="w-full pl-8 p-2 bg-slate-50 border border-slate-100 rounded-lg text-sm focus:bg-white focus:border-slate-300 outline-none transition-colors"
                    defaultValue={activity.notes}
                    onBlur={(_e) => { /* Update logic if needed */ }}
                />
            </div>

            {activeSheet === 'work' ? (
                <WorkDetailSheet
                    workTypes={activity.workTypes || []}
                    onSave={(types, issue) => {
                        if (onUpdateWorkTypes) onUpdateWorkTypes(types);
                        if (onUpdateIssue) onUpdateIssue(issue);
                        setActiveSheet(null);
                    }}
                    onClose={() => setActiveSheet(null)}
                    availableActivities={[]} // Ideally passed from parent
                    sourceText={activity.sourceText}
                    systemInterpretation={activity.systemInterpretation}
                    initialIssue={activity.issue}
                />
            ) : activeSheet === 'input' ? (
                <InputDetailSheet
                    inputs={inputs}
                    onSave={(d) => onUpdateDetails('input', d)}
                    onClose={() => setActiveSheet(null)}
                    profile={profile}
                    currentPlot={currentPlot}
                />
            ) : activeSheet === 'expense' ? (
                <ExpenseDetailSheet
                    initialData={editingExpense}
                    onSave={(data) => {
                        if (editingExpense && onUpdateExpenses) onUpdateExpenses(data);
                        else if (onAddExpense) onAddExpense(data);
                        setActiveSheet(null);
                    }}
                    onClose={() => setActiveSheet(null)}
                />
            ) : activeSheet === 'observation' ? (
                <ObservationHubSheet
                    isOpen={true}
                    onClose={() => setActiveSheet(null)}
                    onSave={(note) => {
                        if (onAddObservation) onAddObservation(note);
                        setActiveSheet(null);
                    }}
                    existingNotes={generalNotes}
                    crops={crops}
                    selectedPlotId={currentPlot?.id}
                    selectedDate={new Date().toLocaleDateString('en-CA')}
                    initialType="observation"
                />
            ) : activeSheet === 'reminder' ? (
                <ObservationHubSheet
                    isOpen={true}
                    onClose={() => setActiveSheet(null)}
                    onSave={(note) => {
                        if (onAddObservation) onAddObservation(note);
                        setActiveSheet(null);
                    }}
                    existingNotes={reminderNotes}
                    crops={crops}
                    selectedPlotId={currentPlot?.id}
                    selectedDate={new Date().toLocaleDateString('en-CA')}
                    initialType="reminder"
                />
            ) : activeSheet === 'disturbance' ? (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center">
                    <div className="bg-white rounded-t-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-6 fade-in-20">
                        {(() => {
                            const disturbance = draftDisturbance || todayLogs?.find((log: DailyLog) => log.disturbance)?.disturbance;

                            if (!disturbance) return null;

                            const getDisturbanceIcon = (group: string = '') => {
                                if (group.toLowerCase().includes('machinery')) return <Wrench className="text-amber-600" size={24} />;
                                if (group.toLowerCase().includes('electricity') || group.toLowerCase().includes('power')) return <Zap className="text-amber-600" size={24} />;
                                if (group.toLowerCase().includes('weather') || group.toLowerCase().includes('rain')) return <Cloud className="text-blue-600" size={24} />;
                                return <AlertTriangle className="text-amber-600" size={24} />;
                            };

                            const scopeColors = {
                                'FULL_DAY': 'bg-red-50 border-red-200 text-red-800',
                                'PARTIAL': 'bg-amber-50 border-amber-200 text-amber-800',
                                'DELAYED': 'bg-yellow-50 border-yellow-200 text-yellow-800'
                            };

                            return (
                                <>
                                    {/* Header */}
                                    <div className="sticky top-0 bg-white border-b border-stone-200 p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            {getDisturbanceIcon(disturbance.group)}
                                            <div>
                                                <h3 className="font-bold text-lg text-stone-800">Issues & Blockers</h3>
                                                <p className="text-xs text-stone-500">{disturbance.group || 'Disturbance'}</p>
                                            </div>
                                        </div>
                                        <button onClick={() => setActiveSheet(null)} className="p-2 hover:bg-stone-100 rounded-full">
                                            <X size={20} />
                                        </button>
                                    </div>

                                    {/* Content */}
                                    <div className="p-6 space-y-4">
                                        {/* Scope Badge */}
                                        <div className={`inline-block px-3 py-1.5 rounded-full text-sm font-bold border ${scopeColors[disturbance.scope || 'PARTIAL']}`}>
                                            {disturbance.scope === 'FULL_DAY' ? '🛑 Full Day Blocked' : disturbance.scope === 'PARTIAL' ? '⚠️ Partial Disruption' : '⏳ Delayed'}
                                        </div>

                                        {/* Reason */}
                                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                                            <div className="text-xs font-bold text-stone-500 uppercase mb-1">Reason</div>
                                            <div className="text-base text-stone-800 font-medium">{disturbance.reason || 'Not specified'}</div>
                                        </div>

                                        {/* Note */}
                                        {disturbance.note && (
                                            <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                                                <div className="text-xs font-bold text-amber-700 uppercase mb-1">Details</div>
                                                <div className="text-sm text-stone-700">{disturbance.note}</div>
                                            </div>
                                        )}

                                        {/* Blocked Segments */}
                                        {disturbance.blockedSegments && disturbance.blockedSegments.length > 0 && (
                                            <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                                                <div className="text-xs font-bold text-stone-500 uppercase mb-2">Affected Areas</div>
                                                <div className="flex flex-wrap gap-2">
                                                    {disturbance.blockedSegments.map((seg, idx) => (
                                                        <span key={idx} className="px-3 py-1 bg-white rounded-lg text-xs font-medium text-stone-700 border border-stone-200">
                                                            {seg.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Transparency Block */}
                                        {(disturbance.sourceText || disturbance.systemInterpretation) && (
                                            <div className="bg-gradient-to-br from-slate-50 to-stone-50 rounded-xl p-4 border border-stone-200">
                                                <div className="text-xs font-bold text-stone-500 uppercase mb-2">🎤 You Said</div>
                                                {disturbance.sourceText && (
                                                    <div className="text-sm italic text-stone-600 mb-2">"{disturbance.sourceText}"</div>
                                                )}
                                                {disturbance.systemInterpretation && (
                                                    <div className="text-xs text-stone-500 mt-1">
                                                        <span className="font-bold">Interpretation:</span> {disturbance.systemInterpretation}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            ) : activeSheet && (

                <DetailSheet
                    type={activeSheet as any}
                    data={linkedData[activeSheet as keyof typeof linkedData]}
                    defaults={defaults}
                    profile={profile}
                    currentPlot={currentPlot}
                    cropContractUnit={cropContractUnit}
                    onSave={(d) => onUpdateDetails(activeSheet as any, d)}
                    onClose={() => setActiveSheet(null)}
                />
            )}
        </div>
    );
};

export default ActivityCard;
