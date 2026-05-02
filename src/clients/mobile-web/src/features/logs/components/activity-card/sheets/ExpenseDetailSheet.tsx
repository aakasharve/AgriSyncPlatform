/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ActivityExpenseEvent, ExpenseItem } from '../../../../../types';
import { X } from 'lucide-react';
import Button from '../../../../../shared/components/ui/Button';

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
    const [items, _setItems] = useState<ExpenseItem[]>(initialData?.items || []);

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

export default ExpenseDetailSheet;
