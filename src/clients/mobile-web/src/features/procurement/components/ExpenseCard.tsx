
import React from 'react';
import { ProcurementExpense } from '../../../types';
import { Calendar, Tag, ChevronRight, AlertCircle, Link as LinkIcon } from 'lucide-react';
import { MoneyChip } from '../../finance/components/MoneyChip';

interface Props {
    expense: ProcurementExpense;
    onClick: (expense: ProcurementExpense) => void;
    onMoneyClick?: (expense: ProcurementExpense) => void;
}

export const ExpenseCard: React.FC<Props> = ({ expense, onClick, onMoneyClick }) => {
    const isLinked = expense.linkedLogIds && expense.linkedLogIds.length > 0;

    return (
        <div
            onClick={() => onClick(expense)}
            className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all active:scale-[0.99] cursor-pointer flex items-center justify-between"
        >
            <div className="flex items-start gap-4">
                {/* Thumbnail or Icon */}
                <div className="w-12 h-12 flex-none bg-stone-100 rounded-xl flex items-center justify-center overflow-hidden border border-stone-200">
                    {expense.receiptImageUrl ? (
                        <img src={expense.receiptImageUrl} alt="Receipt" className="w-full h-full object-cover" />
                    ) : (
                        <Tag size={20} className="text-stone-400" />
                    )}
                </div>

                <div>
                    <div className="text-sm font-bold text-gray-900 line-clamp-1">
                        {expense.vendorName || "Unknown Vendor"}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-1">
                            <Calendar size={10} /> {expense.date}
                        </span>

                        {/* Scope Badge */}
                        <span className={`
                            px-1.5 py-0.5 rounded text-[10px] font-bold uppercase
                            ${expense.scope === 'PLOT' ? 'bg-emerald-100 text-emerald-700' : ''}
                            ${expense.scope === 'CROP' ? 'bg-blue-100 text-blue-700' : ''}
                            ${expense.scope === 'FARM' ? 'bg-amber-100 text-amber-700' : ''}
                        `}>
                            {expense.scope}
                        </span>
                    </div>

                    {/* Items Preview */}
                    <div className="mt-1.5 text-xs text-stone-400 line-clamp-1">
                        {expense.lineItems.map(i => i.name).join(', ')}
                    </div>
                </div>
            </div>

            <div className="text-right">
                {onMoneyClick ? (
                    <MoneyChip amount={expense.grandTotal} onClick={(e) => { e.stopPropagation?.(); onMoneyClick(expense); }} />
                ) : (
                    <div className="text-base font-black text-gray-900">₹{expense.grandTotal.toLocaleString()}</div>
                )}
                <div className="flex items-center justify-end gap-1 mt-1">
                    {expense.paymentStatus === 'CREDIT' && (
                        <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 rounded-md flex items-center gap-1">
                            <AlertCircle size={8} /> CREDIT
                        </span>
                    )}
                    {isLinked && (
                        <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-1.5 rounded-md flex items-center gap-1">
                            <LinkIcon size={8} /> LINKED
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};
