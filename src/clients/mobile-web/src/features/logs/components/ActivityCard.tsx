/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CropActivityEvent, IrrigationEvent, LabourEvent, MachineryEvent, LedgerDefaults, LabourShift, FarmerProfile, Plot, InputEvent, InputMethod, InputMixItem, InputReason, ActivityExpenseEvent, ObservationNote, PlannedTask, CropProfile, DailyLog } from '../../../types';
import { ArrowRight, ChevronRight, Pen, PlusCircle, Trash, ClipboardList, CheckSquare, Link as LinkIcon, Search, Users, Droplets, Tractor, Check, Clock, ChevronDown, Trash2, PenLine, X, AlertTriangle, User, Zap, Package, FlaskConical, Sprout, Plus, Minus, Receipt, MessageSquare, ListPlus, Bell, Mic, Wrench, Cloud } from 'lucide-react';
import Button from '../../../shared/components/ui/Button';
import TrustBadge from '../../../shared/components/ui/TrustBadge';
import { LogVerificationStatus } from '../../../types';
// import ObservationFormSheet from './ObservationFormSheet'; // DEPRECATED
import ObservationHubSheet from './ObservationHubSheet';
import IssueFormSheet from './IssueFormSheet'; // NEW: Shared Issue Form
import { BucketIssue } from '../../../domain/types/log.types';
import { procurementRepository } from '../../../services/procurementRepository';

interface ActivityCardProps {
    activity: CropActivityEvent;
    linkedData: {
        labour?: LabourEvent;
        irrigation?: IrrigationEvent;
        machinery?: MachineryEvent;
    };
    inputs: InputEvent[]; // NEW: Inputs as array
    onUpdateDetails: (type: 'labour' | 'irrigation' | 'machinery' | 'input', data: any) => void;
    onUpdateWorkTypes?: (types: string[]) => void;
    onDeleteActivity: () => void;
    defaults: LedgerDefaults;
    profile: FarmerProfile;
    currentPlot?: Plot;
    cropContractUnit?: string;
    expenses?: ActivityExpenseEvent[];
    onAddExpense?: (exp: ActivityExpenseEvent) => void;
    onUpdateExpenses?: (exp: ActivityExpenseEvent) => void;
    onDeleteExpense?: (expId: string) => void;
    observations?: ObservationNote[];
    onAddObservation?: (obs: ObservationNote) => void;
    plannedTasks?: PlannedTask[];
    crops?: CropProfile[];
    todayLogs?: DailyLog[]; // NEW: To show cumulative daily summary
    onRefineWorkType?: (oldType: string, newType: string, mode: 'manual' | 'voice') => void;
    verificationStatus?: LogVerificationStatus; // DFES Phase 0: Trust badge
    onUpdateIssue?: (issue: BucketIssue | undefined) => void; // NEW
}

const BucketItem = ({ icon, label, sublabel, filled, theme = 'slate', onClick, sourceText, systemInterpretation, hasIssue }: {
    icon: React.ReactNode,
    label: string,
    sublabel?: string,
    filled: boolean,
    theme?: 'slate' | 'emerald' | 'orange' | 'blue' | 'purple' | 'rose' | 'amber' | 'indigo',
    onClick: () => void,
    sourceText?: string,
    systemInterpretation?: string,
    hasIssue?: boolean
}) => {

    // Theme Maps
    const themes = {
        slate: {
            bg: 'bg-slate-50',
            border: 'border-slate-200',
            gradient: 'from-slate-50 to-white',
            text: 'text-slate-600',
            iconBg: 'bg-slate-200',
            iconColor: 'text-slate-500',
            shadow: 'shadow-slate-200'
        },
        emerald: {
            bg: 'bg-emerald-50',
            border: 'border-emerald-200',
            gradient: 'from-emerald-50 to-white',
            text: 'text-emerald-700',
            iconBg: 'bg-emerald-100',
            iconColor: 'text-emerald-600',
            shadow: 'shadow-emerald-200'
        },
        orange: {
            bg: 'bg-orange-50',
            border: 'border-orange-200',
            gradient: 'from-orange-50 to-white',
            text: 'text-orange-700',
            iconBg: 'bg-orange-100',
            iconColor: 'text-orange-600',
            shadow: 'shadow-orange-200'
        },
        blue: {
            bg: 'bg-blue-50',
            border: 'border-blue-200',
            gradient: 'from-blue-50 to-white',
            text: 'text-blue-700',
            iconBg: 'bg-blue-100',
            iconColor: 'text-blue-600',
            shadow: 'shadow-blue-200'
        },
        purple: {
            bg: 'bg-purple-50',
            border: 'border-purple-200',
            gradient: 'from-purple-50 to-white',
            text: 'text-purple-700',
            iconBg: 'bg-purple-100',
            iconColor: 'text-purple-600',
            shadow: 'shadow-purple-200'
        },
        rose: {
            bg: 'bg-rose-50',
            border: 'border-rose-200',
            gradient: 'from-rose-50 to-white',
            text: 'text-rose-700',
            iconBg: 'bg-rose-100',
            iconColor: 'text-rose-600',
            shadow: 'shadow-rose-200'
        },
        amber: {
            bg: 'bg-amber-50',
            border: 'border-amber-200',
            gradient: 'from-amber-50 to-white',
            text: 'text-amber-700',
            iconBg: 'bg-amber-100',
            iconColor: 'text-amber-600',
            shadow: 'shadow-amber-200'
        },
        indigo: {
            bg: 'bg-indigo-50',
            border: 'border-indigo-200',
            gradient: 'from-indigo-50 to-white',
            text: 'text-indigo-700',
            iconBg: 'bg-indigo-100',
            iconColor: 'text-indigo-600',
            shadow: 'shadow-indigo-200'
        }
    };

    const t = themes[theme] || themes.slate;

    return (
        <div
            onClick={onClick}
            className={`
                relative overflow-hidden group transition-all duration-300 cursor-pointer
                rounded-2xl border-2 p-3
                ${filled
                    ? `bg-gradient-to-br ${t.gradient} ${t.border} shadow-lg ${t.shadow} translate-y-[-2px]`
                    : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm hover:shadow-md'
                }
            `}
        >
            {/* Glossy Overlay (Shine) */}
            {filled && (
                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/40 to-white/0 opacity-50" />
            )}

            <div className="relative flex items-center gap-4">
                {/* 3D Icon Box */}
                <div
                    className={`
                        w-12 h-12 rounded-xl flex items-center justify-center shadow-inner transition-transform duration-300 group-hover:scale-110
                        ${filled ? `${t.iconBg} ${t.iconColor} shadow-sm ring-2 ring-white` : 'bg-slate-100 text-slate-400'}
                    `}
                >
                    {React.cloneElement(icon as React.ReactElement<any>, { size: 24, strokeWidth: filled ? 2.5 : 2 })}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <h4 className={`text-base font-bold leading-tight ${filled ? 'text-slate-800' : 'text-slate-500'}`}>
                        {label}
                    </h4>
                    <div className="flex items-center gap-1 mt-0.5">
                        {filled ? (
                            <span className={`text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-white/60 backdrop-blur-sm ${t.text}`}>
                                {sublabel || 'Completed'}
                            </span>
                        ) : (
                            <span className="text-xs font-medium text-slate-400">Tap to add details</span>
                        )}
                    </div>
                </div>

                {/* Action Indicator - with Issue Badge */}
                <div className="flex items-center gap-2">
                    {/* Issue Badge */}
                    {hasIssue && (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-amber-100 text-amber-600 shadow-sm animate-in zoom-in">
                            <AlertTriangle size={16} strokeWidth={2.5} />
                        </div>
                    )}

                    {/* Check/Add Indicator */}
                    <div className={`
                        w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300
                        ${filled ? `bg-white text-emerald-500 shadow-sm opacity-100` : 'bg-slate-50 text-slate-300 opacity-60 group-hover:opacity-100'}
                    `}>
                        {filled ? <Check size={18} strokeWidth={3} /> : <div className="w-2 h-2 rounded-full bg-slate-300" />}
                    </div>
                </div>
            </div>

            {/* NEW: Transparency Feedback (Source -> Interpretation) */}
            {filled && (sourceText || systemInterpretation) && (
                <div className="mt-4 pt-3 border-t border-slate-100/50">
                    <div className="flex flex-col gap-2">
                        {sourceText && (
                            <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">YOU SAID:</span>
                                <p className="text-xs font-medium text-slate-600 italic">"{sourceText}"</p>
                            </div>
                        )}
                        {systemInterpretation && (
                            <div className="flex items-start gap-2 bg-emerald-50/50 p-2 rounded-xl border border-emerald-100/50">
                                <div className="mt-0.5 text-emerald-500">
                                    <Zap size={10} fill="currentColor" />
                                </div>
                                <p className="text-[11px] font-medium text-emerald-800 leading-relaxed">
                                    {systemInterpretation}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};



// --- NEW: Input Application Detail Sheet ---
const InventorySuggestions = ({ query, onSelect }: { query: string, onSelect: (item: { name: string, expenseId: string, itemId: string }) => void }) => {
    const [matches, setMatches] = useState<any[]>([]);

    useEffect(() => {
        if (!query || query.length < 2) {
            setMatches([]);
            return;
        }
        const expenses = procurementRepository.getExpenses();
        // Flatten to items
        const allItems: any[] = [];
        expenses.forEach(exp => {
            exp.lineItems.forEach(li => {
                if (li.name.toLowerCase().includes(query.toLowerCase())) {
                    allItems.push({
                        name: li.name,
                        expenseId: exp.id,
                        itemId: li.id,
                        date: exp.date,
                        vendor: exp.vendorName
                    });
                }
            });
        });
        setMatches(allItems.slice(0, 5));
    }, [query]);

    if (matches.length === 0) return null;

    return (
        <div className="py-1">
            {matches.map(m => (
                <button
                    key={`${m.expenseId}-${m.itemId}`}
                    onClick={() => onSelect(m)}
                    className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center justify-between group"
                >
                    <div>
                        <div className="text-sm font-bold text-slate-700">{m.name}</div>
                        <div className="text-[10px] text-slate-400">{m.vendor} · {m.date}</div>
                    </div>
                </button>
            ))}
        </div>
    );
};
const InputDetailSheet = ({
    inputs,
    onSave,
    onClose,
    profile,
    currentPlot
}: {
    inputs: InputEvent[],
    onSave: (data: InputEvent[]) => void,
    onClose: () => void,
    profile: FarmerProfile,
    currentPlot?: Plot
}) => {
    // We treat the "editing" state as a single object for the UI, but it might result in multiple InputEvents (e.g. Both)
    // For simplicity, we edit one "Main" application logic. If multiple exist, we take the first.
    const [method, setMethod] = useState<InputMethod | 'Both'>(inputs[0]?.method || 'Spray');
    const [carrierType, setCarrierType] = useState<'Blower' | 'Tank' | 'Hours' | 'Pati'>(inputs[0]?.carrierType as any || 'Blower');
    const [carrierCount, setCarrierCount] = useState<number>(inputs[0]?.carrierCount || 0);
    const [mix, setMix] = useState<InputMixItem[]>(inputs[0]?.mix || []);
    const [reason, setReason] = useState<InputReason | undefined>(inputs[0]?.reason);
    const [recommendedBy, setRecommendedBy] = useState<string>(inputs[0]?.recommendedBy || '');

    // --- THEME LOGIC ---
    const isSpray = method === 'Spray' || method === 'Both';
    const SheetIcon = isSpray ? FlaskConical : Sprout;
    const sheetTitle = isSpray ? 'Spray Application' : 'Nutrition & Fertigation';

    // Dynamic Classes
    const focusClass = isSpray ? 'focus:border-purple-500' : 'focus:border-emerald-500';
    const textClass = isSpray ? 'text-purple-600' : 'text-emerald-600';
    const bgClass = isSpray ? 'bg-purple-50' : 'bg-emerald-50';

    // Derived: Selected machinery for Spray
    const sprayers = profile.machineries?.filter(m => m.type === 'Sprayer' || m.type === 'Tractor') || [];
    const [selectedMachineId, setSelectedMachineId] = useState<string>('');

    // NEW: Issue State for Inputs
    const [issue, setIssue] = useState<BucketIssue | undefined>(inputs[0]?.issue);
    const [showIssueSheet, setShowIssueSheet] = useState(false);

    // Update carrier type defaults when method changes
    useEffect(() => {
        if (method === 'Spray') setCarrierType('Blower');
        if (method === 'Drip') setCarrierType('Hours');
        if (method === 'Soil') setCarrierType('Pati');
        if (method === 'Drenching') setCarrierType('Tank');
        if (method === 'Both') setCarrierType('Blower'); // Default to show spray first
    }, [method]);

    const addMixItem = () => {
        setMix([...mix, { id: Date.now().toString(), productName: '', dose: 0, unit: 'ml/L' }]);
    };

    const updateMixItem = (id: string, field: keyof InputMixItem, value: any) => {
        setMix(mix.map(item => item.id === id ? { ...item, [field]: value } : item));
    };

    const removeMixItem = (id: string) => {
        setMix(mix.filter(item => item.id !== id));
    };

    const handleSave = () => {
        // Construct new InputEvents based on "Method"
        const newEvents: InputEvent[] = [];
        const baseEvent = {
            id: inputs[0]?.id || `inp_${Date.now()}`,
            mix,
            reason,
            recommendedBy,
            linkedActivityId: inputs[0]?.linkedActivityId, // Preserve link
            issue: issue // Attach Issue
        };

        if (method === 'Both') {
            // Create Spray Event
            newEvents.push({
                ...baseEvent,
                id: `inp_spray_${Date.now()}`,
                method: 'Spray',
                carrierType: 'Blower', // Simplified for Both
                carrierCount: carrierCount
            });
            // Create Drip Event
            newEvents.push({
                ...baseEvent,
                id: `inp_drip_${Date.now()}`,
                method: 'Drip',
                carrierType: 'Hours',
                carrierCount: 1 // Default 1 hour for ease if not specified
            });
        } else {
            // Calculate Water Volume if possible
            let calculatedVolume = 0;
            // Use NEW Infrastructure details for Calc
            if (method === 'Drip' && carrierType === 'Hours' && currentPlot?.infrastructure?.dripDetails?.flowRatePerHour) {
                calculatedVolume = carrierCount * currentPlot.infrastructure.dripDetails.flowRatePerHour;
            }
            if (method === 'Spray' && (carrierType === 'Blower' || carrierType === 'Tank')) {
                // Try to find capacity from selected machine or default
                const machine = profile.machineries?.find(m => m.id === selectedMachineId);
                const capacity = machine?.capacity || (carrierType === 'Blower' ? 600 : 20);
                calculatedVolume = carrierCount * capacity;
            }

            newEvents.push({
                ...baseEvent,
                method: method as InputMethod,
                carrierType: carrierType as any,
                carrierCount,
                computedWaterVolume: calculatedVolume > 0 ? calculatedVolume : undefined
            });
        }
        onSave(newEvents);
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300" onClick={onClose} />
            <div className="bg-white w-full max-w-lg p-5 rounded-t-3xl shadow-2xl relative z-10 animate-in slide-in-from-bottom-full duration-300 max-h-[85vh] overflow-y-auto flex flex-col">

                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
                        <SheetIcon size={20} className={isSpray ? "text-purple-500" : "text-emerald-500"} />
                        {sheetTitle}
                    </h3>
                    <div className="flex items-center gap-2">
                        {/* Issue Button */}
                        <button
                            onClick={() => setShowIssueSheet(true)}
                            className={`p-2 rounded-full transition-colors ${issue
                                ? 'bg-amber-100 text-amber-600'
                                : 'bg-slate-100 text-slate-400 hover:text-amber-600'
                                }`}
                        >
                            <AlertTriangle size={20} />
                        </button>
                        <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200"><X size={18} /></button>
                    </div>
                </div>

                <div className="space-y-6 flex-1">

                    {/* 1. Method Selection */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase">Method</label>
                        <div className="flex gap-2 mt-1 overflow-x-auto pb-1 scrollbar-hide">
                            {['Spray', 'Both', 'Drip', 'Soil', 'Drenching'].map(m => {
                                const isThisSpray = m === 'Spray' || m === 'Both';
                                const activeClass = isThisSpray
                                    ? 'bg-purple-50 border-purple-200 text-purple-700 ring-2 ring-purple-100'
                                    : 'bg-emerald-50 border-emerald-200 text-emerald-700 ring-2 ring-emerald-100';

                                return (
                                    <button
                                        key={m}
                                        onClick={() => setMethod(m as any)}
                                        className={`px-4 py-2.5 rounded-xl text-sm font-bold border transition-all whitespace-nowrap ${method === m ? activeClass : 'bg-white border-slate-200 text-slate-500'}`}
                                    >
                                        {m}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 2. Carrier Input */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                                {method === 'Spray' && <Tractor size={14} />}
                                {method === 'Drip' && <Clock size={14} />}
                                {method === 'Soil' && <Package size={14} />}
                                Carrier Details
                            </label>
                        </div>

                        <div className="flex gap-3 items-end">
                            {method === 'Spray' && (
                                <div className="flex-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Equipment</label>
                                    <select
                                        className="w-full p-2.5 rounded-xl border border-slate-200 text-sm font-bold outline-none bg-white"
                                        value={selectedMachineId}
                                        onChange={(e) => setSelectedMachineId(e.target.value)}
                                    >
                                        <option value="">Select Blower/Tank...</option>
                                        {sprayers.map(m => (
                                            <option key={m.id} value={m.id}>{m.name} ({m.capacity || '?'}L)</option>
                                        ))}
                                        <option value="manual_blower">Standard Blower (600L)</option>
                                        <option value="manual_tank">Hand Tank (20L)</option>
                                    </select>
                                </div>
                            )}

                            <div className="w-1/3">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">
                                    {method === 'Drip' ? 'Hours' : method === 'Soil' ? 'Count' : 'Count'}
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className={`w-full p-2.5 rounded-xl border border-slate-200 text-lg font-bold outline-none ${focusClass}`}
                                        value={carrierCount || ''}
                                        onChange={e => setCarrierCount(parseFloat(e.target.value))}
                                        placeholder="0"
                                    />
                                    <span className="absolute right-3 top-3 text-xs font-bold text-slate-400">
                                        {method === 'Drip' ? 'Hrs' : method === 'Soil' ? 'Pati' : 'Qty'}
                                    </span>
                                </div>
                            </div>

                            {method === 'Soil' && (
                                <div className="w-1/3">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Unit</label>
                                    <select
                                        className="w-full p-3 rounded-xl border border-slate-200 text-sm font-bold outline-none bg-white"
                                        value={carrierType}
                                        onChange={e => setCarrierType(e.target.value as any)}
                                    >
                                        <option value="Pati">Pati</option>
                                        <option value="Bag">Bag</option>
                                        <option value="Kg">Kg</option>
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 3. Mix Builder */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-slate-400 uppercase">Mix Items</label>
                            <button onClick={addMixItem} className={`text-xs font-bold ${textClass} flex items-center gap-1 hover:${bgClass} px-2 py-1 rounded`}>
                                <Plus size={14} /> Add Item
                            </button>
                        </div>

                        <div className="space-y-2">
                            {mix.map((item, idx) => (
                                <div key={item.id} className="gap-2 items-center animate-in slide-in-from-left-2 rounded-xl border border-slate-100 p-2 bg-slate-50/50">
                                    {/* Top Row: Product Name & Linkage */}
                                    <div className="flex gap-2 mb-2 items-start">
                                        <div className="flex-1 relative group">
                                            <input
                                                placeholder="Product Name"
                                                className={`w-full p-2.5 rounded-xl border text-sm font-bold outline-none ${focusClass} 
                                                    ${item.linkedExpenseId ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-white border-slate-200'}
                                                `}
                                                value={item.productName}
                                                onChange={e => updateMixItem(item.id, 'productName', e.target.value)}
                                            />
                                            {/* Inventory Suggestions (Simple Implementation) */}
                                            {!item.linkedExpenseId && item.productName.length > 1 && (
                                                <div className="absolute top-full left-0 w-full bg-white shadow-xl rounded-xl z-50 border border-slate-100 max-h-40 overflow-y-auto hidden group-focus-within:block">
                                                    {/* This would ideally valid against a prop/hook. For now, we use a placeholder or assume parent passed data. 
                                                         But wait, I need access to repo. Importing it directly is safe in React 18+ if it's a singleton service.
                                                     */}
                                                    <InventorySuggestions
                                                        query={item.productName}
                                                        onSelect={(expItem) => {
                                                            updateMixItem(item.id, 'productName', expItem.name);
                                                            updateMixItem(item.id, 'linkedExpenseId', expItem.expenseId);
                                                            updateMixItem(item.id, 'linkedExpenseItemId', expItem.itemId);
                                                            updateMixItem(item.id, 'costSource', 'PROCUREMENT');
                                                        }}
                                                    />
                                                </div>
                                            )}
                                            {item.linkedExpenseId && (
                                                <div className="absolute right-2 top-2.5 text-emerald-600">
                                                    <LinkIcon size={14} />
                                                </div>
                                            )}
                                        </div>

                                        <button onClick={() => removeMixItem(item.id)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-300 hover:text-red-500">
                                            <X size={18} />
                                        </button>
                                    </div>

                                    {/* Bottom Row: Dose & Unit */}
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <input
                                                type="number"
                                                placeholder="Dose"
                                                className={`w-full p-2.5 rounded-xl border border-slate-200 text-sm font-bold outline-none bg-white ${focusClass}`}
                                                value={item.dose || ''}
                                                onChange={e => updateMixItem(item.id, 'dose', parseFloat(e.target.value))}
                                            />
                                        </div>
                                        <select
                                            className="w-24 p-2.5 rounded-xl border border-slate-200 text-xs font-bold outline-none bg-white"
                                            value={item.unit}
                                            onChange={e => updateMixItem(item.id, 'unit', e.target.value)}
                                        >
                                            <option value="ml/L">ml/L</option>
                                            <option value="g/L">g/L</option>
                                            <option value="kg/ac">kg/ac</option>
                                            <option value="L/ac">L/ac</option>
                                        </select>
                                    </div>

                                    {item.linkedExpenseId && (
                                        <div className="mt-1 text-[10px] text-emerald-600 font-bold px-1 flex justify-between">
                                            <span>Linked to Inventory</span>
                                            <button
                                                onClick={() => {
                                                    updateMixItem(item.id, 'linkedExpenseId', undefined);
                                                    updateMixItem(item.id, 'costSource', undefined);
                                                }}
                                                className="underline hover:text-emerald-800"
                                            >
                                                Unlink
                                            </button>
                                        </div>
                                    )}

                                </div>
                            ))}
                            {mix.length === 0 && (
                                <div className="text-center py-6 border-2 border-dashed border-slate-100 rounded-xl bg-slate-50/50">
                                    <p className="text-slate-400 text-sm">No products added.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 4. Reason & Recommendation */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase">Reason</label>
                        <div className="flex flex-wrap gap-2 mt-1 mb-3">
                            {['Preventive', 'Disease', 'Pest', 'Growth', 'Deficiency'].map(r => (
                                <button
                                    key={r}
                                    onClick={() => setReason(r as InputReason)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${reason === r ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-500'}`}
                                >
                                    {r}
                                </button>
                            ))}
                        </div>
                        <input
                            placeholder="Recommended By (e.g. Dealer Name)"
                            className={`w-full p-3 rounded-xl border border-slate-200 text-sm outline-none ${focusClass}`}
                            value={recommendedBy}
                            onChange={e => setRecommendedBy(e.target.value)}
                        />
                    </div>

                </div>

                <div className="mt-6 pt-4 border-t border-slate-100">
                    <Button onClick={handleSave} className="w-full py-4 shadow-xl">
                        Save Input Application
                    </Button>
                </div>
            </div>

            {/* Issue Form Sheet */}
            <IssueFormSheet
                isOpen={showIssueSheet}
                onClose={() => setShowIssueSheet(false)}
                onSave={(newIssue) => {
                    setIssue(newIssue);
                    setShowIssueSheet(false);
                }}
                initialData={issue}
                bucketType="inputs"
            />
        </div>,
        document.body
    );
};

// --- NEW: Expense Detail Sheet ---
const ExpenseDetailSheet = ({
    initialData,
    onSave,
    onClose
}: {
    initialData?: ActivityExpenseEvent,
    onSave: (data: ActivityExpenseEvent) => void,
    onClose: () => void
}) => {
    const [reason, setReason] = useState(initialData?.reason || '');
    const [amount, setAmount] = useState<number>(initialData?.totalAmount || 0);
    const [notes, setNotes] = useState(initialData?.notes || '');
    const [items, setItems] = useState<any[]>(initialData?.items || []);

    const handleSave = () => {
        const newEvent: ActivityExpenseEvent = {
            id: initialData?.id || `exp_${Date.now()}`,
            reason: reason || 'Expense',
            items: items,
            totalAmount: amount,
            notes: notes
        };
        onSave(newEvent);
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300" onClick={onClose} />
            <div className="bg-white w-full max-w-lg p-5 rounded-t-3xl shadow-2xl relative z-10 animate-in slide-in-from-bottom-full duration-300">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
                        <img src="/assets/rupee_black.png" alt="Expense" className="w-5 h-5 opacity-80" />
                        Add Expense
                    </h3>
                    <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={18} /></button>
                </div>

                <div className="space-y-4 mb-6">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase">Expense Reason</label>
                        <input
                            className="w-full p-3 border border-slate-200 rounded-xl mt-1 font-bold outline-none focus:border-rose-500"
                            placeholder="e.g. Nylon Rope, Tea, Transport"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase">Total Amount (₹)</label>
                        <input
                            type="number"
                            className="w-full p-3 border border-slate-200 rounded-xl mt-1 font-bold text-xl outline-none focus:border-rose-500"
                            placeholder="0"
                            value={amount || ''}
                            onChange={(e) => setAmount(parseFloat(e.target.value))}
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase">Notes (Optional)</label>
                        <textarea
                            className="w-full p-3 border border-slate-200 rounded-xl mt-1 text-sm outline-none focus:border-rose-500 resize-none"
                            placeholder="Additional details..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                        />
                    </div>
                </div>

                <Button onClick={handleSave} className="w-full py-4 shadow-lg bg-rose-600 hover:bg-rose-700 text-white">
                    Save Expense
                </Button>
            </div>
        </div>,
        document.body
    );
};
const DetailSheet = ({
    type,
    data,
    defaults,
    onSave,
    onClose,
    profile,
    currentPlot,
    cropContractUnit
}: {
    type: 'labour' | 'irrigation' | 'machinery',
    data: any,
    defaults: LedgerDefaults,
    onSave: (d: any) => void,
    onClose: () => void,
    profile: FarmerProfile,
    currentPlot?: Plot,
    cropContractUnit?: string
}) => {
    // SYNCHRONOUS INITIALIZATION (Prevents empty flash)
    const [localData, setLocalData] = useState<any>(() => {
        // If editing existing data, use it
        if (data && Object.keys(data).length > 0) return { ...data };

        // Otherwise, generate smart defaults immediately
        if (type === 'labour') {
            const defaultShift = defaults.labour.shifts.find(s => s.name === 'Full Day') || defaults.labour.shifts[0];
            return {
                type: 'HIRED',
                maleCount: 0,
                femaleCount: 0,
                count: 0,
                totalCost: 0,
                shiftId: defaultShift?.id
            };
        }
        if (type === 'irrigation') {
            // Updated to use Infrastructure for Method/Motor
            const infra = currentPlot?.infrastructure;
            const plotMethod = infra?.irrigationMethod || currentPlot?.irrigationPlan?.method || defaults.irrigation.method;
            const plotMotorId = infra?.linkedMotorId || currentPlot?.irrigationPlan?.motorId;
            const linkedSource = plotMotorId
                ? profile.waterResources.find(w => w.id === profile.motors.find(m => m.id === plotMotorId)?.linkedWaterSourceId)?.name
                : 'Well';

            return {
                method: plotMethod === 'None' ? 'Drip' : plotMethod,
                source: linkedSource || 'Well',
                motorId: plotMotorId || '',
                durationHours: currentPlot?.irrigationPlan?.durationMinutes ? currentPlot.irrigationPlan.durationMinutes / 60 : defaults.irrigation.defaultDuration
            };
        }
        if (type === 'machinery') {
            return { type: 'tractor', hoursUsed: 1 };
        }
        return {};
    });

    const [labourTab, setLabourTab] = useState<'HIRED' | 'CONTRACT' | 'SELF'>(localData.type || 'HIRED');
    // Removed legacy irrigationIssue state - now using BucketIssue object type

    // NEW: Issue Sheet State (Replaces inline form)
    const [showIssueSheet, setShowIssueSheet] = useState(false);

    // LABOUR LOGIC
    const handleShiftSelect = (shiftId: string) => {
        setLocalData((prev: any) => ({ ...prev, shiftId }));
    };

    // Auto-calculate total cost whenever counts or shift changes
    useEffect(() => {
        if (type === 'labour' && localData.type === 'HIRED' && localData.shiftId) {
            const shift = defaults.labour.shifts.find(s => s.id === localData.shiftId);
            if (shift) {
                const mCost = (localData.maleCount || 0) * (shift.defaultRateMale || 0);
                const fCost = (localData.femaleCount || 0) * (shift.defaultRateFemale || 0);
                const total = mCost + fCost;

                // Update total cost AND total count
                setLocalData((prev: any) => ({
                    ...prev,
                    totalCost: total,
                    count: (prev.maleCount || 0) + (prev.femaleCount || 0)
                }));
            }
        }
    }, [localData.maleCount, localData.femaleCount, localData.shiftId, localData.type]);

    const handleContractUnitInit = () => {
        if (!localData.contractUnit) {
            // Apply Dynamic Defaults from Plot/Crop
            const unit = cropContractUnit || 'Acre';
            let quantity = 0;
            if (unit === 'Tree' && currentPlot?.baseline.totalPlants) quantity = currentPlot.baseline.totalPlants;
            else if (unit === 'Acre' && currentPlot?.baseline.totalArea) quantity = currentPlot.baseline.totalArea;

            setLocalData({ ...localData, type: 'CONTRACT', contractUnit: unit, contractQuantity: quantity });
        } else {
            setLocalData({ ...localData, type: 'CONTRACT' });
        }
    };

    // Render using Portal to escape parent stacking contexts (Fixes "Blank Glass" issue)
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300"
                onClick={onClose}
            />

            {/* Sheet */}
            <div className="bg-white w-full max-w-lg p-5 rounded-t-3xl shadow-2xl relative z-10 animate-in slide-in-from-bottom-full duration-300">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                    <h3 className="font-bold text-lg capitalize flex items-center gap-2 text-slate-800">
                        {type === 'labour' && <Users size={20} className="text-orange-500" />}
                        {type === 'irrigation' && <Droplets size={20} className="text-blue-500" />}
                        {type === 'machinery' && <Tractor size={20} className="text-slate-500" />}
                        {type === 'labour' ? 'Labour Details' : type === 'irrigation' ? 'Daily Irrigation' : 'Machinery Usage'}
                    </h3>
                    <div className="flex items-center gap-2">
                        {/* Issue Button */}
                        <button
                            onClick={() => setShowIssueSheet(true)}
                            className={`p-2 rounded-full transition-colors ${localData.issue
                                ? 'bg-amber-100 text-amber-600'
                                : 'bg-slate-100 text-slate-400 hover:text-amber-600'
                                }`}
                        >
                            <AlertTriangle size={20} />
                        </button>
                        <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={18} /></button>
                    </div>
                </div>

                <div className="space-y-5 mb-6 max-h-[60vh] overflow-y-auto px-1">

                    {/* --- LABOUR FORM --- */}
                    {type === 'labour' && (
                        <>
                            {/* 1. Labour Type Tabs */}
                            <div className="flex p-1 bg-slate-100 rounded-xl">
                                {['HIRED', 'CONTRACT', 'SELF'].map(t => (
                                    <button
                                        key={t}
                                        onClick={() => {
                                            setLabourTab(t as any);
                                            if (t === 'CONTRACT') handleContractUnitInit();
                                            else setLocalData({ ...localData, type: t });
                                        }}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${labourTab === t ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-600'
                                            }`}
                                    >
                                        {t === 'HIRED' ? 'Daily Wage' : t === 'CONTRACT' ? 'Contract' : 'Self'}
                                    </button>
                                ))}
                            </div>

                            {/* Add Issue Button - REMOVED (Moved to Header) */}
                            {/* Issue Form (Collapsible) - REMOVED (Replaced by IssueFormSheet) */}

                            {/* 2. Content based on Tab */}
                            {labourTab === 'HIRED' && (
                                <div className="space-y-4 animate-in fade-in">
                                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                        {defaults.labour.shifts.map(shift => (
                                            <button
                                                key={shift.id}
                                                onClick={() => handleShiftSelect(shift.id)}
                                                className={`px-4 py-2.5 rounded-xl border text-xs font-bold whitespace-nowrap transition-all ${localData.shiftId === shift.id ? 'bg-orange-50 border-orange-200 text-orange-800 ring-2 ring-orange-100' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                            >
                                                {shift.name}
                                            </button>
                                        ))}
                                    </div>

                                    {/* 3. Counts with Validation */}
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Total Labours</label>
                                            <input
                                                type="number"
                                                className="w-full p-3 border border-slate-200 rounded-xl font-bold text-lg mt-1 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none"
                                                value={localData.count || ''}
                                                placeholder="0"
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value) || 0;
                                                    setLocalData({ ...localData, count: val });
                                                }}
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Male Split</label>
                                                <input
                                                    type="number"
                                                    className={`w-full p-3 border rounded-xl font-bold text-lg mt-1 focus:ring-2 outline-none ${localData.count && (localData.maleCount || 0) + (localData.femaleCount || 0) !== localData.count
                                                        ? 'border-amber-300 bg-amber-50 focus:ring-amber-500/20'
                                                        : 'border-slate-200 focus:ring-orange-500/20 focus:border-orange-500'
                                                        }`}
                                                    value={localData.maleCount || ''}
                                                    placeholder="0"
                                                    onChange={e => setLocalData({ ...localData, maleCount: parseFloat(e.target.value) || 0 })}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Female Split</label>
                                                <input
                                                    type="number"
                                                    className={`w-full p-3 border rounded-xl font-bold text-lg mt-1 focus:ring-2 outline-none ${localData.count && (localData.maleCount || 0) + (localData.femaleCount || 0) !== localData.count
                                                        ? 'border-amber-300 bg-amber-50 focus:ring-amber-500/20'
                                                        : 'border-slate-200 focus:ring-orange-500/20 focus:border-orange-500'
                                                        }`}
                                                    value={localData.femaleCount || ''}
                                                    placeholder="0"
                                                    onChange={e => setLocalData({ ...localData, femaleCount: parseFloat(e.target.value) || 0 })}
                                                />
                                            </div>
                                        </div>

                                        {localData.count && (localData.maleCount || 0) + (localData.femaleCount || 0) > 0 &&
                                            (localData.maleCount || 0) + (localData.femaleCount || 0) !== localData.count && (
                                                <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                                                    <AlertTriangle size={10} />
                                                    Split ({(localData.maleCount || 0) + (localData.femaleCount || 0)}) doesn't match Total ({localData.count})
                                                </p>
                                            )}
                                    </div>

                                    {/* Auto-Calculated Total */}
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center">
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">Total Paid (Auto)</p>
                                            <p className="text-xs text-slate-500 mt-0.5">Based on shift rates</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-lg font-bold text-slate-400">₹</span>
                                            <input
                                                type="number"
                                                className="bg-transparent font-mono text-2xl font-bold text-slate-800 outline-none w-32 text-right"
                                                value={localData.totalCost || ''}
                                                onChange={e => setLocalData({ ...localData, totalCost: parseFloat(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {labourTab === 'CONTRACT' && (
                                <div className="space-y-4 animate-in fade-in">
                                    <div className="flex gap-2">
                                        <div className="w-1/3">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Unit</label>
                                            <select
                                                className="w-full p-3 border border-slate-200 rounded-xl mt-1 bg-white text-sm font-bold focus:ring-2 focus:ring-orange-500/20 outline-none"
                                                value={localData.contractUnit || 'Acre'}
                                                onChange={e => setLocalData({ ...localData, contractUnit: e.target.value })}
                                            >
                                                <option value="Tree">Per Tree</option>
                                                <option value="Acre">Per Acre</option>
                                                <option value="Row">Per Row</option>
                                                <option value="Lump Sum">Lump Sum</option>
                                            </select>
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">Quantity</label>
                                            <input
                                                type="number"
                                                className="w-full p-3 border border-slate-200 rounded-xl mt-1 focus:ring-2 focus:ring-orange-500/20 outline-none"
                                                value={localData.contractQuantity || ''}
                                                placeholder={localData.contractUnit === 'Tree' ? 'No. of Trees' : 'Qty'}
                                                onChange={e => setLocalData({ ...localData, contractQuantity: parseFloat(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Total Contract Amount (₹)</label>
                                        <input
                                            type="number"
                                            className="w-full p-3 border border-slate-200 rounded-xl mt-1 font-bold text-lg focus:ring-2 focus:ring-orange-500/20 outline-none"
                                            value={localData.totalCost || ''}
                                            placeholder="0"
                                            onChange={e => setLocalData({ ...localData, totalCost: parseFloat(e.target.value) })}
                                        />
                                    </div>
                                </div>
                            )}

                            {labourTab === 'SELF' && (
                                <div className="animate-in fade-in bg-slate-50 p-6 rounded-xl border border-slate-200 text-center">
                                    <User size={32} className="mx-auto text-slate-400 mb-2" />
                                    <p className="text-sm font-bold text-slate-600">Self / Family Labour</p>
                                    <p className="text-xs text-slate-400 mt-1">No cost will be recorded for this activity.</p>
                                </div>
                            )}
                        </>
                    )}

                    {/* --- IRRIGATION FORM --- */}
                    {type === 'irrigation' && (
                        <>
                            {/* Add Issue Button - REMOVED (Moved to Header) */}
                            {/* Issue Form - REMOVED (Replaced by IssueFormSheet) */}

                            <div className="flex gap-2">
                                {[1, 2, 4, 6].map(hrs => (
                                    <button
                                        key={hrs}
                                        onClick={() => setLocalData({ ...localData, durationHours: hrs })}
                                        className={`flex-1 py-3 rounded-xl border font-bold transition-all ${localData.durationHours === hrs ? 'bg-blue-50 border-blue-300 text-blue-700 ring-1 ring-blue-200' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
                                    >
                                        {hrs}h
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Source</label>
                                    <select
                                        className="w-full p-2.5 border border-slate-200 rounded-xl bg-white mt-1 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                                        value={localData.motorId || ''}
                                        onChange={e => {
                                            const motor = profile.motors.find(m => m.id === e.target.value);
                                            const source = profile.waterResources.find(w => w.id === motor?.linkedWaterSourceId);
                                            setLocalData({ ...localData, motorId: e.target.value, source: source?.name || 'Unknown' });
                                        }}
                                    >
                                        <option value="">Select Motor</option>
                                        {profile.motors.map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Method</label>
                                    <select
                                        className="w-full p-2.5 border border-slate-200 rounded-xl bg-white mt-1 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                                        value={localData.method || 'Drip'}
                                        onChange={e => setLocalData({ ...localData, method: e.target.value })}
                                    >
                                        <option value="Drip">Drip</option>
                                        <option value="Flood">Flood</option>
                                        <option value="Sprinkler">Sprinkler</option>
                                    </select>
                                </div>
                            </div>
                        </>
                    )}

                    {/* --- MACHINERY FORM --- */}
                    {type === 'machinery' && (
                        <>
                            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                                {['tractor', 'sprayer', 'rotavator'].map(m => (
                                    <button
                                        key={m}
                                        onClick={() => setLocalData({ ...localData, type: m })}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg capitalize transition-all ${localData.type === m ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-600'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>

                            {/* Add Issue Button - REMOVED (Moved to Header) */}
                            {/* Issue Form - REMOVED (Replaced by IssueFormSheet) */}

                            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl mb-2">
                                {['owned', 'rented'].map(o => (
                                    <button
                                        key={o}
                                        onClick={() => {
                                            const cost = o === 'rented' ? (defaults.machinery.defaultRentalCost || 1000) : (defaults.machinery.defaultFuelCost || 200);
                                            setLocalData({ ...localData, ownership: o, rentalCost: cost });
                                        }}
                                        className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg capitalize transition-all ${localData.ownership === o ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-600'}`}
                                    >
                                        {o}
                                    </button>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400 uppercase">Usage (Hrs)</label>
                                    <input
                                        type="number"
                                        className={`w-full p-3 border rounded-xl mt-1 font-bold focus:ring-2 outline-none ${localData.ownership === 'owned' && !localData.hoursUsed
                                            ? 'border-amber-300 bg-amber-50 focus:ring-amber-500/20'
                                            : 'border-slate-200 focus:ring-slate-500/20'
                                            }`}
                                        value={localData.hoursUsed || ''}
                                        placeholder="0"
                                        autoFocus
                                        onChange={e => setLocalData({ ...localData, hoursUsed: parseFloat(e.target.value) })}
                                    />
                                    {localData.ownership === 'owned' && !localData.hoursUsed && (
                                        <p className="text-[10px] text-amber-600 font-bold mt-1">Hours mandatory for owned</p>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400 uppercase text-right block">
                                        {localData.ownership === 'rented' ? 'Rental Cost (₹)' : 'Fuel Cost (₹)'}
                                    </label>
                                    <input
                                        type="number"
                                        className="w-full p-3 border border-slate-200 rounded-xl mt-1 focus:ring-2 focus:ring-slate-500/20 outline-none text-right"
                                        value={localData.rentalCost || ''}
                                        placeholder="0"
                                        onChange={e => setLocalData({ ...localData, rentalCost: parseFloat(e.target.value) })}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <Button onClick={() => { onSave(localData); onClose(); }} className="w-full py-4 text-sm shadow-lg">
                    Confirm Details
                </Button>
            </div>

            <IssueFormSheet
                isOpen={showIssueSheet}
                onClose={() => setShowIssueSheet(false)}
                onSave={(newIssue) => {
                    setLocalData({ ...localData, issue: newIssue });
                    setShowIssueSheet(false);
                }}
                initialData={localData.issue}
                bucketType={type}
            />
        </div>,
        document.body // PORTAL TARGET
    );
};

// --- NEW: Work/Tasks Detail Sheet ---
const WorkDetailSheet = ({
    workTypes,
    onSave,
    onClose,
    availableActivities,
    sourceText,
    systemInterpretation,
    initialIssue
}: {
    workTypes: string[],
    onSave: (types: string[], issue?: BucketIssue) => void,
    onClose: () => void,
    availableActivities?: any[], // WorkflowStep[] technically
    sourceText?: string,
    systemInterpretation?: string,
    initialIssue?: BucketIssue
}) => {
    const [selected, setSelected] = useState<string[]>(workTypes || []);
    const [custom, setCustom] = useState('');
    const [issue, setIssue] = useState<BucketIssue | undefined>(initialIssue);
    const [showIssueSheet, setShowIssueSheet] = useState(false);

    const toggle = (name: string) => {
        if (selected.includes(name)) setSelected(selected.filter(s => s !== name));
        else setSelected([...selected, name]);
    };

    const addCustom = (e: React.FormEvent) => {
        e.preventDefault();
        if (custom.trim() && !selected.includes(custom.trim())) {
            setSelected([...selected, custom.trim()]);
            setCustom('');
        }
    };

    const suggested = availableActivities?.filter(a => a.type === 'activity').map(a => a.name) || [];
    // Combine suggested with currently selected to show all
    const allOptions = Array.from(new Set([...suggested, ...selected]));

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300" onClick={onClose} />
            <div className="bg-white w-full max-w-lg p-5 rounded-t-3xl shadow-2xl relative z-10 animate-in slide-in-from-bottom-full duration-300">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
                        <ListPlus size={20} className="text-emerald-500" />
                        Work Done
                    </h3>
                    <div className="flex items-center gap-2">
                        {/* Issue Button */}
                        <button
                            onClick={() => setShowIssueSheet(true)}
                            className={`p-2 rounded-full transition-colors ${issue
                                ? 'bg-amber-100 text-amber-600'
                                : 'bg-slate-100 text-slate-400 hover:text-amber-600'
                                }`}
                        >
                            <AlertTriangle size={20} />
                        </button>
                        <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={18} /></button>
                    </div>
                </div>

                <div className="space-y-4 mb-6 max-h-[60vh] overflow-y-auto pr-1">
                    {/* NEW: Transparency Feedback inside Sheet */}
                    {(sourceText || systemInterpretation) && (
                        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 mb-4 animate-in fade-in slide-in-from-top-2">
                            {sourceText && (
                                <div className="flex items-start gap-2 mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5 whitespace-nowrap">YOU SAID:</span>
                                    <p className="text-xs font-medium text-slate-600 italic">"{sourceText}"</p>
                                </div>
                            )}
                            {systemInterpretation && (
                                <div className="flex items-start gap-2 bg-emerald-100/30 p-2 rounded-xl border border-emerald-50">
                                    <div className="mt-0.5 text-emerald-500">
                                        <Zap size={10} fill="currentColor" />
                                    </div>
                                    <p className="text-[11px] font-medium text-emerald-800 leading-relaxed">
                                        {systemInterpretation}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    <p className="text-sm text-slate-500">Select activities performed today:</p>

                    <div className="flex flex-wrap gap-2">
                        {allOptions.map(opt => (
                            <button
                                key={opt}
                                onClick={() => toggle(opt)}
                                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${selected.includes(opt)
                                    ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-200'}`}
                            >
                                {opt}
                                {selected.includes(opt) && <Check size={14} className="inline ml-1.5" />}
                            </button>
                        ))}
                    </div>

                    <form onSubmit={addCustom} className="flex gap-2 pt-2">
                        <input
                            className="flex-1 p-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-emerald-500"
                            placeholder="Add other activity..."
                            value={custom}
                            onChange={e => setCustom(e.target.value)}
                        />
                        <button disabled={!custom.trim()} className="bg-slate-800 text-white px-4 rounded-lg font-bold text-sm disabled:opacity-50">Add</button>
                    </form>
                </div>

                <Button onClick={() => { onSave(selected, issue); onClose(); }} className="w-full py-4 shadow-lg">
                    Save Work Details
                </Button>
            </div>

            {/* Issue Form Sheet */}
            <IssueFormSheet
                isOpen={showIssueSheet}
                onClose={() => setShowIssueSheet(false)}
                onSave={(newIssue) => {
                    setIssue(newIssue);
                    setShowIssueSheet(false);
                }}
                initialData={issue}
                bucketType="crop_activity"
            />
        </div>,
        document.body
    );
};

const ActivityCard: React.FC<ActivityCardProps> = ({
    activity,
    linkedData,
    inputs,
    onUpdateDetails,
    onUpdateWorkTypes,
    onRefineWorkType,
    onDeleteActivity,
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
        const types = new Set<string>();
        plotTodayLogs.forEach(l => {
            l.cropActivities.forEach(act => {
                act.workTypes?.forEach(w => types.add(w));
            });
        });
        return Array.from(types);
    };

    // State for Sheets
    const [activeSheet, setActiveSheet] = useState<'work' | 'labour' | 'irrigation' | 'machinery' | 'input' | 'expense' | 'observation' | 'reminder' | 'disturbance' | null>(null);
    const [editingExpense, setEditingExpense] = useState<ActivityExpenseEvent | undefined>(undefined);

    // Aggregation-Aware Filled States
    const dailyLabour = getDailyLabourTotal();
    const dailyIrrigationHours = getDailyIrrigationTotal();
    const dailyMachineryHours = getDailyMachineryTotal();
    const dailyInputCount = getDailyInputsTotal();
    const dailyExpenseTotal = getDailyExpenseTotal();
    const dailyIrrigation = getDailyIrrigationTotal();

    const isLabourFilled = !!linkedData.labour || dailyLabour.totalWorkers > 0;
    const isLabourIssue = !!linkedData.labour?.issue;

    const isIrrigationFilled = !!linkedData.irrigation || dailyIrrigation > 0;
    const isIrrigationIssue = !!linkedData.irrigation?.issue;
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
    const isAnySubBucketFilled = isLabourFilled || isIrrigationFilled || isMachineryFilled || isInputsFilled || isExpensesFilled || isObservationsFilled;
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
                {todayLogs && todayLogs.length > 0 && (() => {
                    const disturbanceLogs = todayLogs.filter(log => log.disturbance);
                    const hasDisturbance = disturbanceLogs.length > 0;
                    const disturbance = disturbanceLogs[0]?.disturbance;

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
                    onBlur={(e) => { /* Update logic if needed */ }}
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
                            const disturbanceLogs = todayLogs?.filter((log: DailyLog) => log.disturbance) || [];
                            const disturbance = disturbanceLogs[0]?.disturbance;

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
