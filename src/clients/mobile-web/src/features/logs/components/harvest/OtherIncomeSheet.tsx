/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
    OtherIncomeEntry,
    CropProfile
} from '../../../../types';
import { X, Save } from 'lucide-react';
import { addOtherIncomeEntry } from '../../../../services/harvestService';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';

interface OtherIncomeSheetProps {
    crops: CropProfile[]; // For linking to crop
    onClose: () => void;
    onSave: () => void;
}

const OtherIncomeSheet: React.FC<OtherIncomeSheetProps> = ({ crops, onClose, onSave }) => {
    const [amount, setAmount] = useState<string>('');
    const [source, setSource] = useState<OtherIncomeEntry['source']>('OTHER');
    const [description, setDescription] = useState('');
    const [date, setDate] = useState(getDateKey());
    const [selectedCropId, setSelectedCropId] = useState<string>('');

    const handleSubmit = () => {
        if (!amount || !description) return;

        addOtherIncomeEntry({
            amount: parseFloat(amount),
            source,
            description,
            date,
            cropId: selectedCropId || undefined
            // plotId can be added if we select plot context
        });

        onSave();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-3xl shadow-xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-100">
                    <h2 className="text-lg font-bold text-slate-800">Add Other Income</h2>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <div className="p-4 space-y-4 overflow-y-auto">

                    {/* Amount */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Amount Received</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="w-full pl-8 p-3 rounded-xl border border-slate-200 text-lg font-bold text-slate-900 focus:border-emerald-500 outline-none"
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    {/* Source Type */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Source</label>
                        <div className="flex flex-wrap gap-2">
                            {['RESIDUE', 'BYPRODUCT', 'PLANT_SALE', 'OTHER'].map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setSource(s as any)}
                                    className={`px-3 py-2 rounded-lg text-sm border font-medium ${source === s
                                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                        : 'bg-white border-slate-200 text-slate-600'
                                        }`}
                                >
                                    {s.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Description</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full p-3 rounded-xl border border-slate-200 focus:border-emerald-500 outline-none"
                            placeholder="e.g. Sold scrap drip pipes"
                        />
                    </div>

                    {/* Crop Context (Optional) */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Related Crop (Optional)</label>
                        <select
                            value={selectedCropId}
                            onChange={(e) => setSelectedCropId(e.target.value)}
                            className="w-full p-3 rounded-xl border border-slate-200 bg-white"
                        >
                            <option value="">-- General Farm Income --</option>
                            {crops.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Date */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Date</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full p-3 rounded-xl border border-slate-200 bg-white"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-3xl sm:rounded-b-2xl">
                    <button
                        onClick={handleSubmit}
                        disabled={!amount || !description}
                        className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <Save size={18} />
                        Save Income
                    </button>
                </div>

            </div>
        </div>
    );
};

export default OtherIncomeSheet;
