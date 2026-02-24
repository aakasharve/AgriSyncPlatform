import React, { useState, useMemo } from 'react';
import { Divide, AreaChart, Edit3, Check, AlertCircle, X } from 'lucide-react';
import { Plot } from '../../../types';
import { AllocateGlobalExpenseCommand, AllocationDetailPayload } from '../../../application/usecases/sync/AllocateGlobalExpenseCommand';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';

type AllocationBasis = 'equal' | 'by_acreage' | 'custom';

interface Props {
     costEntryId: string;
     totalAmount: number;
     plots: Plot[];
     onAllocate: (allocations: AllocationDetailPayload[]) => void;
     onCancel: () => void;
}

/**
 * AllocationSelector — 3-strategy cost allocation for farm-scoped expenses
 *
 * When a cost entry is farm-scoped (no specific plot), this component lets the user
 * distribute the expense across plots using: Equal, By Plot Size, or Custom Amounts.
 */
const AllocationSelector: React.FC<Props> = ({ costEntryId, totalAmount, plots, onAllocate, onCancel }) => {
     const [basis, setBasis] = useState<AllocationBasis>('equal');
     const [customAmounts, setCustomAmounts] = useState<Record<string, number>>(() => {
          const initial: Record<string, number> = {};
          plots.forEach(p => { initial[p.id] = 0; });
          return initial;
     });
     const [isSubmitting, setIsSubmitting] = useState(false);

     // ── Equal allocation ──
     const equalAllocations = useMemo((): AllocationDetailPayload[] => {
          if (plots.length === 0) return [];
          const baseAmount = Math.floor((totalAmount / plots.length) * 100) / 100;
          const remainder = Math.round((totalAmount - baseAmount * plots.length) * 100) / 100;
          return plots.map((p, i) => ({
               plotId: p.id,
               amount: i === 0 ? baseAmount + remainder : baseAmount
          }));
     }, [plots, totalAmount]);

     // ── By acreage allocation ──
     const allHaveArea = plots.every(p => p.baseline?.totalArea && p.baseline.totalArea > 0);
     const totalArea = plots.reduce((sum, p) => sum + (p.baseline?.totalArea || 0), 0);
     const acreageAllocations = useMemo((): AllocationDetailPayload[] => {
          if (!allHaveArea || totalArea === 0) return [];
          return plots.map(p => ({
               plotId: p.id,
               amount: Math.round(((p.baseline?.totalArea || 0) / totalArea) * totalAmount * 100) / 100
          }));
     }, [plots, totalAmount, allHaveArea, totalArea]);

     // ── Custom allocation ──
     const customTotal = useMemo(() => {
          return Object.values(customAmounts).reduce((s, v) => s + (v || 0), 0);
     }, [customAmounts]);
     const customDiff = Math.round((customTotal - totalAmount) * 100) / 100;
     const customValid = Math.abs(customDiff) <= 0.01;

     const customAllocations: AllocationDetailPayload[] = plots.map(p => ({
          plotId: p.id,
          amount: customAmounts[p.id] || 0
     }));

     // ── Active allocations ──
     const activeAllocations = basis === 'equal' ? equalAllocations
          : basis === 'by_acreage' ? acreageAllocations
               : customAllocations;

     const canSubmit = basis !== 'custom' || customValid;

     const handleConfirm = async () => {
          setIsSubmitting(true);
          try {
               await AllocateGlobalExpenseCommand.enqueue({
                    costEntryId,
                    allocationBasis: basis,
                    allocations: activeAllocations,
               });
               void backgroundSyncWorker.triggerNow();
               onAllocate(activeAllocations);
          } catch (e) {
               console.error('Failed to enqueue allocation', e);
          } finally {
               setIsSubmitting(false);
          }
     };

     const strategies: { key: AllocationBasis; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
          { key: 'equal', label: 'Split Equally', icon: <Divide size={16} /> },
          { key: 'by_acreage', label: 'By Plot Size', icon: <AreaChart size={16} />, disabled: !allHaveArea },
          { key: 'custom', label: 'Custom Amounts', icon: <Edit3 size={16} /> },
     ];

     return (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-5 animate-in fade-in slide-in-from-bottom-4">
               {/* Header */}
               <div className="flex items-center justify-between mb-4">
                    <div>
                         <h3 className="text-lg font-black text-slate-800">Allocate Expense</h3>
                         <p className="text-xs text-slate-400 font-medium">₹{totalAmount.toLocaleString('en-IN')} across {plots.length} plots</p>
                    </div>
                    <button onClick={onCancel} className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors">
                         <X size={16} className="text-slate-500" />
                    </button>
               </div>

               {/* Strategy Chips */}
               <div className="flex gap-2 mb-5">
                    {strategies.map(s => (
                         <button
                              key={s.key}
                              onClick={() => !s.disabled && setBasis(s.key)}
                              disabled={s.disabled}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold transition-all ${basis === s.key
                                   ? 'bg-slate-800 text-white shadow-md'
                                   : s.disabled
                                        ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                   }`}
                         >
                              {s.icon}
                              {s.label}
                         </button>
                    ))}
               </div>

               {/* Acreage disabled warning */}
               {basis === 'by_acreage' && !allHaveArea && (
                    <div className="mb-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                         <AlertCircle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                         <p className="text-xs text-amber-700 font-medium">Some plots are missing area data. Please set plot acreage in Profile first.</p>
                    </div>
               )}

               {/* Plot Breakdown */}
               <div className="space-y-2 mb-5">
                    {plots.map(p => {
                         const alloc = activeAllocations.find(a => a.plotId === p.id);
                         const area = p.baseline?.totalArea;
                         const areaUnit = p.baseline?.unit || 'acres';

                         return (
                              <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                                   <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-slate-700 truncate">{p.name}</p>
                                        {basis === 'by_acreage' && area && (
                                             <p className="text-[10px] text-slate-400 font-medium">{area} {areaUnit}</p>
                                        )}
                                   </div>

                                   {basis === 'custom' ? (
                                        <div className="flex items-center gap-1">
                                             <span className="text-sm font-bold text-slate-500">₹</span>
                                             <input
                                                  type="number"
                                                  value={customAmounts[p.id] || ''}
                                                  onChange={(e) => setCustomAmounts(prev => ({ ...prev, [p.id]: Number(e.target.value) || 0 }))}
                                                  className="w-24 text-right text-sm font-black text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400"
                                                  placeholder="0"
                                             />
                                        </div>
                                   ) : (
                                        <span className="text-sm font-black text-slate-800">
                                             ₹{(alloc?.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </span>
                                   )}
                              </div>
                         );
                    })}
               </div>

               {/* Custom Total Validation */}
               {basis === 'custom' && (
                    <div className={`mb-4 p-3 rounded-xl border text-xs font-bold flex items-center justify-between ${customValid
                         ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                         : customDiff > 0
                              ? 'bg-red-50 border-red-200 text-red-700'
                              : 'bg-amber-50 border-amber-200 text-amber-700'
                         }`}>
                         <span>Total: ₹{customTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                         <span>
                              {customValid ? '✓ Matches' : customDiff > 0 ? `₹${customDiff.toFixed(2)} over` : `₹${Math.abs(customDiff).toFixed(2)} remaining`}
                         </span>
                    </div>
               )}

               {/* Confirm */}
               <button
                    onClick={handleConfirm}
                    disabled={!canSubmit || isSubmitting}
                    className="w-full py-3.5 bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:shadow-none transition-all active:scale-[0.98]"
               >
                    <Check size={18} />
                    {isSubmitting ? 'Allocating...' : 'Confirm Allocation'}
               </button>
          </div>
     );
};

export default AllocationSelector;
