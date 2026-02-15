/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Trash2, Plus, X, ShoppingBag, Receipt, ChevronDown, ChevronUp } from 'lucide-react';
import { ActivityExpenseEvent, ExpenseItem } from '../../../types';
import Button from '../../../shared/components/ui/Button';

interface ActivityExpenseCardProps {
    expense: ActivityExpenseEvent;
    onUpdate: (updated: ActivityExpenseEvent) => void;
    onDelete: () => void;
}

const ActivityExpenseCard: React.FC<ActivityExpenseCardProps> = ({ expense, onUpdate, onDelete }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [mode, setMode] = useState<'simple' | 'itemized'>(expense.items.length > 0 ? 'itemized' : 'simple');

    // Sync total if items change
    useEffect(() => {
        if (mode === 'itemized') {
            const sum = expense.items.reduce((acc, item) => acc + (item.total || 0), 0);
            if (sum !== expense.totalAmount) {
                onUpdate({ ...expense, totalAmount: sum });
            }
        }
    }, [expense.items, mode]);

    const handleAddItem = () => {
        const newItem: ExpenseItem = {
            id: Date.now().toString(),
            name: '',
            qty: 1,
            unit: 'Nos',
            unitPrice: 0,
            total: 0
        };
        onUpdate({ ...expense, items: [...expense.items, newItem] });
        setMode('itemized'); // Force itemized mode
    };

    const updateItem = (id: string, field: keyof ExpenseItem, value: any) => {
        const newItems = expense.items.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: value };
                // Recalculate line total
                if (field === 'qty' || field === 'unitPrice') {
                    updated.total = (updated.qty || 0) * (updated.unitPrice || 0);
                }
                return updated;
            }
            return item;
        });
        onUpdate({ ...expense, items: newItems });
    };

    const deleteItem = (id: string) => {
        onUpdate({ ...expense, items: expense.items.filter(i => i.id !== id) });
    };

    return (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 animate-in fade-in slide-in-from-bottom-2">

            {/* Header Row */}
            <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3 flex-1">
                    <div className="bg-rose-50 p-2 rounded-xl text-rose-600">
                        <img src="/assets/rupee_black.png" alt="Expense" className="w-5 h-5 opacity-80" />
                    </div>
                    <div className="flex-1">
                        <input
                            className="font-bold text-lg text-stone-800 outline-none w-full bg-transparent placeholder:text-stone-300"
                            placeholder="Reason (e.g. Nylon Rope)"
                            value={expense.reason}
                            onChange={(e) => onUpdate({ ...expense, reason: e.target.value })}
                        />
                        <input
                            className="text-xs font-bold text-stone-400 outline-none w-full bg-transparent placeholder:text-stone-300 uppercase tracking-wide"
                            placeholder="Vendor Name (Optional)"
                            value={expense.vendor || ''}
                            onChange={(e) => onUpdate({ ...expense, vendor: e.target.value })}
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="bg-stone-50 rounded-lg px-2 py-1 border border-stone-100 flex items-center gap-1">
                        <span className="text-stone-400 font-bold">₹</span>
                        <input
                            type="number"
                            className={`w-20 bg-transparent font-bold text-lg text-right outline-none ${mode === 'itemized' ? 'text-stone-500' : 'text-stone-800'}`}
                            placeholder="0"
                            value={expense.totalAmount || ''}
                            readOnly={mode === 'itemized'}
                            onChange={(e) => mode === 'simple' && onUpdate({ ...expense, totalAmount: parseFloat(e.target.value) })}
                        />
                    </div>
                    <button onClick={onDelete} className="text-stone-300 hover:text-rose-500 transition-colors p-1">
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>

            {/* Toggle Itemization */}
            <div className="flex justify-between items-center">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-xs font-bold text-stone-400 flex items-center gap-1 hover:text-stone-600"
                >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {mode === 'itemized' ? `${expense.items.length} Items` : 'Add Details'}
                </button>
            </div>

            {/* Itemized List */}
            {isExpanded && (
                <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
                    {/* Mode Toggle */}
                    <div className="flex gap-2 mb-4">
                        <button
                            onClick={() => setMode('simple')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${mode === 'simple' ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-400 border-stone-200'}`}
                        >
                            Simple Amount
                        </button>
                        <button
                            onClick={() => setMode('itemized')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${mode === 'itemized' ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-400 border-stone-200'}`}
                        >
                            Itemized List
                        </button>
                    </div>

                    {mode === 'itemized' && (
                        <div className="space-y-2">
                            {expense.items.map((item, idx) => (
                                <div key={item.id} className="flex gap-2 items-center">
                                    <input
                                        className="flex-1 p-2 bg-stone-50 rounded-lg text-sm font-bold text-stone-700 outline-none border border-transparent focus:border-stone-200"
                                        placeholder="Item Name"
                                        value={item.name}
                                        onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                                    />
                                    <div className="w-16">
                                        <input
                                            type="number"
                                            className="w-full p-2 bg-stone-50 rounded-lg text-sm font-bold text-stone-700 outline-none border border-transparent focus:border-stone-200"
                                            placeholder="Qty"
                                            value={item.qty || ''}
                                            onChange={(e) => updateItem(item.id, 'qty', parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div className="w-20 relative">
                                        <span className="absolute left-1.5 top-2 text-xs text-stone-400">₹</span>
                                        <input
                                            type="number"
                                            className="w-full pl-4 p-2 bg-stone-50 rounded-lg text-sm font-bold text-stone-700 outline-none border border-transparent focus:border-stone-200"
                                            placeholder="Price"
                                            value={item.unitPrice || ''}
                                            onChange={(e) => updateItem(item.id, 'unitPrice', parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <button onClick={() => deleteItem(item.id)} className="text-stone-300 hover:text-rose-500">
                                        <X size={16} />
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={handleAddItem}
                                className="w-full py-2 border border-dashed border-stone-300 rounded-lg text-stone-400 text-xs font-bold hover:bg-stone-50 transition-colors flex items-center justify-center gap-1"
                            >
                                <Plus size={14} /> Add Item
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ActivityExpenseCard;
