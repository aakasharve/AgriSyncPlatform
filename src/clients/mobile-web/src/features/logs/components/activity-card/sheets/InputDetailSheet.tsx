/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FarmerProfile, Plot, InputEvent, InputMethod, InputMixItem, InputReason } from '../../../../../types';
import { AlertTriangle, Tractor, Clock, Package, FlaskConical, Sprout, Plus, X, Link as LinkIcon } from 'lucide-react';
import Button from '../../../../../shared/components/ui/Button';
import IssueFormSheet from '../../IssueFormSheet';
import { BucketIssue } from '../../../../../domain/types/log.types';
import InventorySuggestions from '../components/InventorySuggestions';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
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
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
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
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
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
                            {mix.map((item, _idx) => (
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

export default InputDetailSheet;
