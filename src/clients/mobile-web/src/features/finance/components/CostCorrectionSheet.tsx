import React, { useState } from 'react';
import { X, CornerDownRight, AlertCircle } from 'lucide-react';
import { financeCommandService } from '../financeCommandService';

interface Props {
     costEntryId: string;
     originalAmount: number;
     category: string;
     onClose: () => void;
     onCorrected: () => void;
}

/**
 * CostCorrectionSheet — Bottom sheet for correcting a cost entry amount.
 *
 * Creates a correction record (not an edit) — the original remains in the ledger
 * with a strikethrough, and the new corrected amount is shown alongside.
 */
const CostCorrectionSheet: React.FC<Props> = ({ costEntryId, originalAmount, category, onClose, onCorrected }) => {
     const [correctedAmount, setCorrectedAmount] = useState<number>(originalAmount);
     const [reason, setReason] = useState('');
     const [isSubmitting, setIsSubmitting] = useState(false);

     const canSubmit = reason.trim().length > 0 && correctedAmount !== originalAmount;

     const handleSubmit = () => {
          if (!canSubmit) return;
          setIsSubmitting(true);

          try {
               financeCommandService.applyAdjustment({
                    adjustsMoneyEventId: costEntryId,
                    correctedFields: { amount: correctedAmount },
                    reason: reason.trim(),
                    correctedByUserId: 'current_user', // resolved by command service
               });
               onCorrected();
               onClose();
          } catch (e) {
               console.error('Correction failed', e);
          } finally {
               setIsSubmitting(false);
          }
     };

     return (
          <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
               <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl animate-in slide-in-from-bottom-8">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                         <div>
                              <h3 className="text-lg font-black text-slate-800">Correct Amount</h3>
                              <p className="text-xs text-slate-400 font-medium">{category}</p>
                         </div>
                         <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200">
                              <X size={18} className="text-slate-500" />
                         </button>
                    </div>

                    <div className="p-5 space-y-5">
                         {/* Original amount */}
                         <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Original Amount</p>
                              <p className="text-xl font-black text-slate-400 line-through">
                                   ₹{originalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </p>
                         </div>

                         {/* Corrected amount */}
                         <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Corrected Amount</p>
                              <div className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-xl focus-within:border-emerald-400 transition-colors">
                                   <span className="text-xl font-black text-slate-600">₹</span>
                                   <input
                                        type="number"
                                        value={correctedAmount}
                                        onChange={(e) => setCorrectedAmount(Number(e.target.value) || 0)}
                                        className="flex-1 text-xl font-black text-slate-800 outline-none bg-transparent"
                                        autoFocus
                                   />
                              </div>
                              {correctedAmount !== originalAmount && (
                                   <div className="flex items-center gap-1 mt-2 text-xs font-bold">
                                        <CornerDownRight size={12} className="text-slate-400" />
                                        <span className={correctedAmount > originalAmount ? 'text-red-600' : 'text-emerald-600'}>
                                             {correctedAmount > originalAmount ? '+' : ''}₹{(correctedAmount - originalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </span>
                                   </div>
                              )}
                         </div>

                         {/* Reason */}
                         <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Reason for Correction *</p>
                              <textarea
                                   value={reason}
                                   onChange={(e) => setReason(e.target.value)}
                                   maxLength={500}
                                   rows={3}
                                   placeholder="Why does this amount need correction?"
                                   className="w-full p-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 outline-none focus:border-emerald-400 resize-none transition-colors bg-slate-50"
                              />
                              <div className="flex justify-between mt-1">
                                   {reason.length === 0 && (
                                        <span className="text-[10px] text-red-400 font-medium flex items-center gap-1">
                                             <AlertCircle size={10} /> Required
                                        </span>
                                   )}
                                   <span className="text-[10px] text-slate-300 font-medium ml-auto">{reason.length}/500</span>
                              </div>
                         </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-slate-100 flex gap-3">
                         <button onClick={onClose} className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors">
                              Cancel
                         </button>
                         <button
                              onClick={handleSubmit}
                              disabled={!canSubmit || isSubmitting}
                              className="flex-[2] py-3 bg-amber-500 text-white font-bold rounded-xl shadow-lg shadow-amber-200 disabled:opacity-50 disabled:shadow-none transition-all active:scale-[0.98]"
                         >
                              {isSubmitting ? 'Correcting...' : 'Apply Correction'}
                         </button>
                    </div>
               </div>
          </div>
     );
};

export default CostCorrectionSheet;
