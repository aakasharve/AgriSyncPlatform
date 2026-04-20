/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
    HarvestSession,
    HarvestUnit,
    ProduceGrade,
    DEFAULT_PRODUCE_GRADES,
    SaleEntry
} from '../../../../types';
import {
    X,
    Plus,
    Trash2,
    Save,
    IndianRupee,
    Scale,
    Package
} from 'lucide-react';
import Button from '../../../../shared/components/ui/Button';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';

interface GradeWiseEntrySheetProps {
    session: HarvestSession;
    onClose: () => void;
    onSave: (updatedSession: HarvestSession) => void;
    initialData?: any; // Parsed Patti Data
}

interface GradeEntryRow {
    id: string;
    gradeId: string;
    quantity: number;
    pricePerUnit: number;
    rateUnitWeight: number; // 1 for Kg, 10 for 10Kg, 100 for Quintal
    aiRateUnit?: string; // Store original string from AI
}

const GradeWiseEntrySheet: React.FC<GradeWiseEntrySheetProps> = ({ session, onClose, onSave, initialData }) => {
    // State
    const [rows, setRows] = useState<GradeEntryRow[]>([]);
    const [pattiNumber, setPattiNumber] = useState('');
    const [date, setDate] = useState(getDateKey());
    const [detectedReceiptUnit, setDetectedReceiptUnit] = useState<string | null>(null);

    // Deductions
    const [commission, setCommission] = useState<number>(0);
    const [transport, setTransport] = useState<number>(0);
    const [hamali, setHamali] = useState<number>(0);
    const [bharai, setBharai] = useState<number>(0);
    const [tolai, setTolai] = useState<number>(0);
    const [motorFee, setMotorFee] = useState<number>(0);
    const [otherDeductions, setOtherDeductions] = useState<number>(0);

    // Initialize with breakdown if exists, else one empty row
    useEffect(() => {
        if (initialData) {
            // Pre-fill from AI Extraction
            if (initialData.date) setDate(initialData.date);
            if (initialData.pattiNumber) setPattiNumber(initialData.pattiNumber);

            if (initialData.deductions) {
                setCommission(initialData.deductions.commission || 0);
                setTransport(initialData.deductions.transport || 0);
                setHamali(initialData.deductions.hamali || 0);
                setBharai(initialData.deductions.bharai || 0);
                setTolai(initialData.deductions.tolai || 0);
                setMotorFee(initialData.deductions.motorFee || 0);
                setOtherDeductions(initialData.deductions.other || 0);
            }

            if (initialData.items && initialData.items.length > 0) {
                // Find first valid rate unit to set as global default
                const firstUnit = initialData.items.find((i: any) => i.rateUnit)?.rateUnit;
                if (firstUnit) setDetectedReceiptUnit(firstUnit);

                const aiRows = initialData.items.map((item: any, idx: number) => {
                    // Try to map extracted gradeRaw to known ID
                    // Simple heuristic: First letter matching or loose string match
                    // This logic can be improved later
                    const matchedGrade = DEFAULT_PRODUCE_GRADES.find(g =>
                        g.name.toLowerCase().includes(item.gradeRaw?.toLowerCase()) ||
                        item.gradeRaw?.toLowerCase().includes(g.name.toLowerCase())
                    );

                    // Parse Rate Unit from AI
                    let rWeight = 1;
                    const rUnitStr = String(item.rateUnit || '').toLowerCase();

                    // improved parsing: try to find number
                    const match = rUnitStr.match(/(\d+)/);
                    if (match && match[0]) {
                        rWeight = parseInt(match[0]);
                    } else if (rUnitStr.includes('quintal') || rUnitStr.includes('kwintal')) {
                        rWeight = 100;
                    } else if (rUnitStr.includes('10')) {
                        rWeight = 10;
                    }

                    return {
                        id: `row_ai_${idx}`,
                        gradeId: matchedGrade ? matchedGrade.id : 'g_other', // Fallback needed? or just use first
                        quantity: item.quantity || 0,
                        pricePerUnit: item.rate || 0,
                        rateUnitWeight: rWeight,
                        aiRateUnit: item.rateUnit
                    };
                });
                setRows(aiRows);
            } else {
                setRows([{ id: 'row_init', gradeId: 'g1', quantity: 0, pricePerUnit: 0, rateUnitWeight: 1 }]);
            }
        } else if (session.gradeWiseBreakdown && session.gradeWiseBreakdown.length > 0) {
            const existingRows = session.gradeWiseBreakdown.map((g, idx) => ({
                id: `row_${idx}`,
                gradeId: g.gradeId,
                quantity: g.quantity,
                pricePerUnit: g.pricePerUnit,
                rateUnitWeight: 1, // Default to 1 on edit for now (or store in SaleEntry if needed later)
                aiRateUnit: undefined
            }));
            setRows(existingRows);
        } else {
            setRows([{ id: 'row_init', gradeId: 'g1', quantity: 0, pricePerUnit: 0, rateUnitWeight: 1 }]);
        }
    }, [session, initialData]);

    // Helpers
    const addRow = () => {
        let weight = 1;
        if (detectedReceiptUnit) {
            const lower = detectedReceiptUnit.toLowerCase();
            if (lower.includes('10')) weight = 10;
            else if (lower.includes('quintal') || lower.includes('100')) weight = 100;
        }
        setRows([...rows, { id: `row_${Date.now()}`, gradeId: 'g2', quantity: 0, pricePerUnit: 0, rateUnitWeight: weight, aiRateUnit: detectedReceiptUnit || undefined }]);
    };

    const removeRow = (id: string) => {
        setRows(rows.filter(r => r.id !== id));
    };

    const updateRow = (id: string, field: keyof GradeEntryRow, value: any) => {
        setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    // Calculations
    const totalQty = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    const grossAmount = rows.reduce((sum, r) => sum + ((Number(r.quantity) || 0) * ((Number(r.pricePerUnit) || 0) / (r.rateUnitWeight || 1))), 0);
    const totalDeductions = Number(commission) + Number(transport) + Number(hamali) + Number(bharai) + Number(tolai) + Number(motorFee) + Number(otherDeductions);
    const netAmount = grossAmount - totalDeductions;

    const handleSave = () => {
        // Construct Sale Entry
        const saleEntry: SaleEntry = {
            id: `sale_${Date.now()}`,
            date: date,
            gradeWiseSales: rows.map(r => {
                const grade = DEFAULT_PRODUCE_GRADES.find(g => g.id === r.gradeId);
                return {
                    gradeId: r.gradeId,
                    gradeName: grade?.name || 'Unknown',
                    quantity: Number(r.quantity),
                    unit: session.unit.type === 'WEIGHT' ? (session.unit.weightUnit || 'KG') : (session.unit.containerName || 'Unit'),
                    pricePerUnit: Number(r.pricePerUnit),
                    totalAmount: Number(r.quantity) * Number(r.pricePerUnit)
                };
            }),
            totalQuantity: totalQty,
            totalAmount: grossAmount,
            commissionAmount: Number(commission),
            transportDeduction: Number(transport),
            hamaliDeduction: Number(hamali),
            bharaiDeduction: Number(bharai),
            tolaiDeduction: Number(tolai),
            motorFeeDeduction: Number(motorFee),
            otherDeductions: Number(otherDeductions),
            netAmount: netAmount,
            pattiNumber: pattiNumber,
            aiExtracted: false,
            userVerified: true
        };

        // Update Session
        const updatedSession: HarvestSession = {
            ...session,
            status: 'SOLD',
            saleEntries: [...session.saleEntries, saleEntry], // Append sale
            totalIncome: session.totalIncome + netAmount,
            amountPending: session.amountPending + netAmount, // Assuming pending until paid
            paymentStatus: session.paymentStatus === 'RECEIVED' ? 'PARTIAL' : 'PENDING',
            // Update grade breakdown (simplified: just replacing with latest sale for now, valid for Single Sale)
            gradeWiseBreakdown: rows.map(r => {
                const grade = DEFAULT_PRODUCE_GRADES.find(g => g.id === r.gradeId);
                const amt = Number(r.quantity) * Number(r.pricePerUnit);
                return {
                    gradeId: r.gradeId,
                    gradeName: grade?.name || 'Unknown',
                    quantity: Number(r.quantity),
                    percentage: totalQty > 0 ? (Number(r.quantity) / totalQty) * 100 : 0,
                    pricePerUnit: Number(r.pricePerUnit),
                    totalAmount: amt,
                    averagePrice: Number(r.pricePerUnit)
                };
            })
        };

        onSave(updatedSession);
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full max-w-lg sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col">

                {/* Header */}
                <div className="sticky top-0 bg-white z-10 p-4 border-b border-slate-100 flex items-center justify-between rounded-t-3xl">
                    <div>
                        <h2 className="font-bold text-lg text-slate-800">New Sale Entry</h2>
                        <p className="text-xs text-slate-400">Enter details from Patti / Bill</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-6">

                    {/* Basic Details */}
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-xs font-bold text-slate-400 uppercase">Date</label>
                            <input
                                type="date"
                                value={date}
                                onChange={e => setDate(e.target.value)}
                                className="w-full font-bold text-slate-800 border-b border-slate-200 py-2 focus:border-emerald-500 outline-none"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-bold text-slate-400 uppercase">Patti No.</label>
                            <input
                                type="text"
                                placeholder="Optional"
                                value={pattiNumber}
                                onChange={e => setPattiNumber(e.target.value)}
                                className="w-full font-bold text-slate-800 border-b border-slate-200 py-2 focus:border-emerald-500 outline-none"
                            />
                        </div>
                    </div>

                    {/* Grade Rows */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-400 uppercase">Grade Breakdown</label>
                            <button onClick={addRow} className="text-emerald-600 text-xs font-bold flex items-center gap-1">
                                <Plus size={14} /> Add Grade
                            </button>
                        </div>

                        {rows.map((row) => (
                            <div key={row.id} className="flex gap-2 items-center animate-in slide-in-from-right fade-in duration-200">
                                {/* Grade Select */}
                                <select
                                    value={row.gradeId}
                                    onChange={e => updateRow(row.id, 'gradeId', e.target.value)}
                                    className="w-1/3 bg-slate-50 rounded-lg p-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                                >
                                    {DEFAULT_PRODUCE_GRADES.map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>

                                {/* Quantity */}
                                <div className="relative flex-1">
                                    <input
                                        type="number"
                                        placeholder="Qty"
                                        value={row.quantity || ''}
                                        onChange={e => updateRow(row.id, 'quantity', parseFloat(e.target.value))}
                                        className="w-full bg-slate-50 rounded-lg p-3 pl-8 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                                    />
                                    <span className="absolute left-3 top-3.5 text-slate-400">
                                        {session.unit.type === 'WEIGHT' ? <Scale size={14} /> : <Package size={14} />}
                                    </span>
                                </div>

                                {/* Price */}
                                <div className="relative flex-1">
                                    <input
                                        type="number"
                                        placeholder="Rate"
                                        value={row.pricePerUnit || ''}
                                        onChange={e => updateRow(row.id, 'pricePerUnit', parseFloat(e.target.value))}
                                        className="w-full bg-slate-50 rounded-lg p-3 pl-7 pr-16 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                                    />
                                    <span className="absolute left-2.5 top-3.5 text-slate-400 text-xs font-bold">₹</span>

                                    {/* Rate Unit Dropdown */}
                                    <div className="absolute right-1 top-1 bottom-1">
                                        <select
                                            value={row.rateUnitWeight || 1}
                                            onChange={e => updateRow(row.id, 'rateUnitWeight', parseInt(e.target.value))}
                                            className="h-full bg-transparent text-[10px] font-bold text-slate-500 outline-none border-l border-slate-200 px-1"
                                            style={{ maxWidth: '80px' }}
                                        >
                                            <option value={1}>/ Kg</option>
                                            <option value={10}>/ 10Kg</option>
                                            <option value={100}>/ 100Kg</option>
                                            {/* Dynamic Option from AI */}
                                            {(row.aiRateUnit || detectedReceiptUnit) && (
                                                <option className="bg-emerald-50 text-emerald-700 font-bold" value={(() => {
                                                    const unit = row.aiRateUnit || detectedReceiptUnit || '';
                                                    const match = unit.match(/(\d+)/);
                                                    if (match) return parseInt(match[0]);
                                                    if (unit.toLowerCase().includes('quintal')) return 100;
                                                    return 1;
                                                })()}>
                                                    Receipt ({row.aiRateUnit || detectedReceiptUnit})
                                                </option>
                                            )}
                                        </select>
                                    </div>
                                </div>

                                {/* Delete */}
                                <button onClick={() => removeRow(row.id)} className="p-2 text-rose-400 hover:text-rose-600">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Deductions */}
                    <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                        <label className="text-xs font-bold text-slate-400 uppercase block">Deductions</label>
                        <div className="grid grid-cols-2 gap-4">
                            {/* Commission */}
                            <div>
                                <label className="text-[10px] text-slate-500 mb-1 block">Commission (Adat)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={commission || ''}
                                        onChange={e => setCommission(parseFloat(e.target.value))}
                                        className="w-full bg-white rounded-lg p-2 pl-6 font-bold text-sm outline-none border border-slate-200 focus:border-emerald-500"
                                    />
                                    <span className="absolute left-2.5 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                </div>
                            </div>
                            {/* Transport */}
                            <div>
                                <label className="text-[10px] text-slate-500 mb-1 block">Transport</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={transport || ''}
                                        onChange={e => setTransport(parseFloat(e.target.value))}
                                        className="w-full bg-white rounded-lg p-2 pl-6 font-bold text-sm outline-none border border-slate-200 focus:border-emerald-500"
                                    />
                                    <span className="absolute left-2.5 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                </div>
                            </div>
                            {/* Hamali */}
                            <div>
                                <label className="text-[10px] text-slate-500 mb-1 block">Hamali (Labor)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={hamali || ''}
                                        onChange={e => setHamali(parseFloat(e.target.value))}
                                        className="w-full bg-white rounded-lg p-2 pl-6 font-bold text-sm outline-none border border-slate-200 focus:border-emerald-500"
                                    />
                                    <span className="absolute left-2.5 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                </div>
                            </div>
                            {/* Bharai */}
                            <div>
                                <label className="text-[10px] text-slate-500 mb-1 block">Bharai (Filling)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={bharai || ''}
                                        onChange={e => setBharai(parseFloat(e.target.value))}
                                        className="w-full bg-white rounded-lg p-2 pl-6 font-bold text-sm outline-none border border-slate-200 focus:border-emerald-500"
                                    />
                                    <span className="absolute left-2.5 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                </div>
                            </div>
                            {/* Tolai */}
                            <div>
                                <label className="text-[10px] text-slate-500 mb-1 block">Tolai (Weighing)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={tolai || ''}
                                        onChange={e => setTolai(parseFloat(e.target.value))}
                                        className="w-full bg-white rounded-lg p-2 pl-6 font-bold text-sm outline-none border border-slate-200 focus:border-emerald-500"
                                    />
                                    <span className="absolute left-2.5 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                </div>
                            </div>
                            {/* Motor Fee */}
                            <div>
                                <label className="text-[10px] text-slate-500 mb-1 block">Motor Fee / Market</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={motorFee || ''}
                                        onChange={e => setMotorFee(parseFloat(e.target.value))}
                                        className="w-full bg-white rounded-lg p-2 pl-6 font-bold text-sm outline-none border border-slate-200 focus:border-emerald-500"
                                    />
                                    <span className="absolute left-2.5 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                </div>
                            </div>
                            {/* Other */}
                            <div>
                                <label className="text-[10px] text-slate-500 mb-1 block">Other (Levy, Mapai)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={otherDeductions || ''}
                                        onChange={e => setOtherDeductions(parseFloat(e.target.value))}
                                        className="w-full bg-white rounded-lg p-2 pl-6 font-bold text-sm outline-none border border-slate-200 focus:border-emerald-500"
                                    />
                                    <span className="absolute left-2.5 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer / Totals */}
                    <div className="border-t border-slate-100 pt-4 space-y-1">
                        <div className="flex justify-between text-sm text-slate-500">
                            <span>Gross Total</span>
                            <span>₹{grossAmount.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm text-rose-500">
                            <span>Total Deductions</span>
                            <span>- ₹{totalDeductions.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xl font-bold text-emerald-700 pt-2">
                            <span>Net Income</span>
                            <span>₹{netAmount.toLocaleString()}</span>
                        </div>
                    </div>

                    <Button onClick={handleSave} className="w-full" variant="primary" icon={<Save size={20} />}>
                        Save Entry
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default GradeWiseEntrySheet;
