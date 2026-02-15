/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect } from 'react';
import { X, Check, Droplets, Users, Package, Tractor, CheckSquare } from 'lucide-react';
import Button from '../../../shared/components/ui/Button';
import { CropProfile, Plot, LedgerDefaults } from '../../../types';

type CategoryType = 'task' | 'irrigation' | 'labour' | 'input' | 'machinery';

interface MiniFormSheetProps {
    category: CategoryType | null;
    defaults: LedgerDefaults;
    onClose: () => void;
    onSave: (category: CategoryType, data: any) => void;
}

const MiniFormSheet: React.FC<MiniFormSheetProps> = ({ category, defaults, onClose, onSave }) => {
    const [data, setData] = useState<any>({});
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (category) {
            setIsVisible(true);
            // Initialize defaults based on category
            if (category === 'irrigation') {
                setData({
                    method: defaults.irrigation.method,
                    source: defaults.irrigation.source,
                    durationHours: defaults.irrigation.defaultDuration
                });
            } else if (category === 'labour') {
                setData({ whoWorked: 'HIRED_LABOUR', count: 1, wagePerPerson: defaults.labour.defaultWage, activity: '' });
            } else if (category === 'machinery') {
                // Default to rented initially
                setData({ type: 'tractor', ownership: 'rented', hoursUsed: 1, rentalCost: defaults.machinery.defaultRentalCost });
            } else if (category === 'input') {
                setData({ type: 'fertilizer', unit: 'kg', method: 'soil' });
            } else if (category === 'task') {
                setData({ status: 'completed' });
            }
        } else {
            setIsVisible(false);
        }
    }, [category, defaults]);

    const handleSave = () => {
        onSave(category!, data);
        onClose();
    };

    const update = (field: string, val: any) => setData({ ...data, [field]: val });

    // Handle smart defaults for machinery costs based on ownership
    const updateMachineryOwnership = (ownership: 'owned' | 'rented') => {
        const newData = { ...data, ownership };
        if (ownership === 'owned') {
            // If owned, we usually track fuel cost, not rental cost. 
            // Reset rental cost and set default fuel cost if not present.
            newData.rentalCost = undefined;
            if (!newData.fuelCost) newData.fuelCost = defaults.machinery.defaultFuelCost;
        } else {
            // If rented, we track rental cost.
            newData.fuelCost = undefined;
            if (!newData.rentalCost) newData.rentalCost = defaults.machinery.defaultRentalCost;
        }
        setData(newData);
    };

    if (!category) return null;

    return (
        <div className={`fixed inset-0 z-50 flex items-end justify-center pointer-events-none`}>
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 pointer-events-auto ${isVisible ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Sheet */}
            <div className={`bg-white w-full max-w-lg rounded-t-3xl shadow-2xl pointer-events-auto transform transition-transform duration-300 ease-out ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white rounded-t-3xl">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-emerald-100 rounded-full text-emerald-700">
                            {category === 'task' && <CheckSquare size={18} />}
                            {category === 'irrigation' && <Droplets size={18} />}
                            {category === 'labour' && <Users size={18} />}
                            {category === 'input' && <Package size={18} />}
                            {category === 'machinery' && <Tractor size={18} />}
                        </div>
                        <h3 className="font-bold text-lg capitalize text-slate-800">Add {category}</h3>
                    </div>
                    <button onClick={onClose} className="p-2 bg-slate-50 rounded-full text-slate-500 hover:bg-slate-100"><X size={18} /></button>
                </div>

                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* --- TASK FORM --- */}
                    {category === 'task' && (
                        <>
                            <input
                                placeholder="What task was done? (e.g. Pruning)"
                                className="w-full p-3 border border-slate-200 rounded-xl text-lg font-bold text-slate-800 outline-none focus:border-emerald-500"
                                autoFocus
                                value={data.taskName || ''}
                                onChange={e => update('taskName', e.target.value)}
                            />
                            <div className="flex gap-3">
                                <input
                                    type="number"
                                    placeholder="Qty (Optional)"
                                    className="w-24 p-3 border border-slate-200 rounded-xl outline-none focus:border-emerald-500"
                                    value={data.quantityCompleted || ''}
                                    onChange={e => update('quantityCompleted', parseFloat(e.target.value))}
                                />
                                <input
                                    placeholder="Unit (rows, plants)"
                                    className="flex-1 p-3 border border-slate-200 rounded-xl outline-none focus:border-emerald-500"
                                    value={data.unit || ''}
                                    onChange={e => update('unit', e.target.value)}
                                />
                            </div>
                        </>
                    )}

                    {/* --- IRRIGATION FORM --- */}
                    {category === 'irrigation' && (
                        <div className="space-y-4">
                            <div className="flex gap-2">
                                {['drip', 'flood', 'sprinkler'].map(m => (
                                    <button key={m} onClick={() => update('method', m)} className={`flex-1 py-2 rounded-lg border text-sm font-bold capitalize ${data.method === m ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-slate-200 text-slate-500'}`}>{m}</button>
                                ))}
                            </div>
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400">Source</label>
                                    <select value={data.source} onChange={e => update('source', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl bg-white mt-1 outline-none focus:border-blue-500">
                                        <option value="well">Well</option>
                                        <option value="canal">Canal</option>
                                        <option value="borewell">Borewell</option>
                                    </select>
                                </div>
                                <div className="w-32">
                                    <label className="text-xs font-bold text-slate-400">Hours</label>
                                    <input type="number" value={data.durationHours || ''} onChange={e => update('durationHours', parseFloat(e.target.value))} className="w-full p-3 border border-slate-200 rounded-xl mt-1 outline-none focus:border-blue-500" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- LABOUR FORM --- */}
                    {category === 'labour' && (
                        <div className="space-y-4">
                            <input
                                placeholder="Activity (e.g. Weeding)"
                                className="w-full p-3 border border-slate-200 rounded-xl font-bold outline-none focus:border-orange-500"
                                value={data.activity || ''}
                                onChange={e => update('activity', e.target.value)}
                            />
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400">Workers</label>
                                    <input type="number" value={data.count || ''} onChange={e => update('count', parseInt(e.target.value))} className="w-full p-3 border border-slate-200 rounded-xl mt-1 outline-none focus:border-orange-500" />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400">Wage (₹)</label>
                                    <input type="number" value={data.wagePerPerson || ''} onChange={e => update('wagePerPerson', parseFloat(e.target.value))} className="w-full p-3 border border-slate-200 rounded-xl mt-1 outline-none focus:border-orange-500" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- INPUT FORM --- */}
                    {category === 'input' && (
                        <div className="space-y-4">
                            <select value={data.type} onChange={e => update('type', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none focus:border-purple-500">
                                <option value="fertilizer">Fertilizer</option>
                                <option value="pesticide">Pesticide</option>
                                <option value="fungicide">Fungicide</option>
                            </select>
                            <input
                                placeholder="Product Name"
                                className="w-full p-3 border border-slate-200 rounded-xl font-bold outline-none focus:border-purple-500"
                                value={data.productName || ''}
                                onChange={e => update('productName', e.target.value)}
                            />
                            <div className="flex gap-3">
                                <input type="number" placeholder="Qty" value={data.quantity || ''} onChange={e => update('quantity', parseFloat(e.target.value))} className="flex-1 p-3 border border-slate-200 rounded-xl outline-none focus:border-purple-500" />
                                <select value={data.unit} onChange={e => update('unit', e.target.value)} className="w-24 p-3 border border-slate-200 rounded-xl bg-white outline-none focus:border-purple-500">
                                    <option value="kg">kg</option>
                                    <option value="ltr">ltr</option>
                                    <option value="bag">bag</option>
                                </select>
                            </div>
                            <input type="number" placeholder="Cost (₹)" value={data.cost || ''} onChange={e => update('cost', parseFloat(e.target.value))} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-purple-500" />
                        </div>
                    )}

                    {/* --- MACHINERY FORM --- */}
                    {category === 'machinery' && (
                        <div className="space-y-4">
                            <div className="flex gap-2">
                                {['owned', 'rented'].map(o => (
                                    <button key={o} onClick={() => updateMachineryOwnership(o as any)} className={`flex-1 py-2 rounded-lg border text-sm font-bold capitalize ${data.ownership === o ? 'bg-slate-800 text-white' : 'border-slate-200 text-slate-500'}`}>{o}</button>
                                ))}
                            </div>
                            <select value={data.type} onChange={e => update('type', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none focus:border-slate-500">
                                <option value="tractor">Tractor</option>
                                <option value="rotavator">Rotavator</option>
                                <option value="sprayer">Sprayer</option>
                            </select>
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400">Hours</label>
                                    <input type="number" value={data.hoursUsed || ''} onChange={e => update('hoursUsed', parseFloat(e.target.value))} className="w-full p-3 border border-slate-200 rounded-xl mt-1 outline-none focus:border-slate-500" />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400">
                                        {data.ownership === 'owned' ? 'Fuel Cost (₹)' : 'Rental Cost (₹)'}
                                    </label>
                                    {data.ownership === 'owned' ? (
                                        <input
                                            type="number"
                                            value={data.fuelCost || ''}
                                            onChange={e => update('fuelCost', parseFloat(e.target.value))}
                                            className="w-full p-3 border border-slate-200 rounded-xl mt-1 outline-none focus:border-slate-500"
                                        />
                                    ) : (
                                        <input
                                            type="number"
                                            value={data.rentalCost || ''}
                                            onChange={e => update('rentalCost', parseFloat(e.target.value))}
                                            className="w-full p-3 border border-slate-200 rounded-xl mt-1 outline-none focus:border-slate-500"
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <Button onClick={handleSave} className="w-full mt-4 bg-slate-900 text-white shadow-xl">
                        Add to Daily Log
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default MiniFormSheet;
