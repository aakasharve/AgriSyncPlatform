/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { SprayCan, Leaf, ChevronDown, ChevronUp } from 'lucide-react';
import { InputsSummary, InputItem } from '../../../domain/types/summary.types';
import { formatCurrency } from '../../../shared/utils/currency';

interface InputsEventCardProps {
    inputs: InputsSummary;
}

/** Returns true if this item should be classified as a Spray */
function isSprayItem(item: InputItem): boolean {
    const method = (item.applicationMethod || '').toLowerCase();
    const type = (item.inputType || '').toLowerCase();
    return method === 'spray'
        || type === 'pesticide'
        || type === 'fungicide';
}

/**
 * Inputs Event Card — Split into Spray 🔫 and Nutrition 🌱 sections
 * 
 * Aligns with the Schedule's 4-bucket comparison model:
 *   Schedule  →  Spray | Fertigation | Irrigation | Activities
 *   Log Card  →  Spray | Nutrition   (this card handles both)
 */
const InputsEventCard: React.FC<InputsEventCardProps> = ({ inputs }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (inputs.isEmpty || inputs.items.length === 0) {
        return (
            <div className="event-card event-card-empty">
                <div className="event-header">
                    <Leaf size={20} className="event-icon" />
                    <span className="event-title">Inputs</span>
                </div>
                <p className="empty-state-text">No inputs used today</p>
            </div>
        );
    }

    const sprays = inputs.items.filter(isSprayItem);
    const nutrition = inputs.items.filter(i => !isSprayItem(i));
    const sprayCost = sprays.reduce((s, i) => s + (i.individualCost || 0), 0);
    const nutritionCost = nutrition.reduce((s, i) => s + (i.individualCost || 0), 0);

    return (
        <div className="event-card">
            <button
                className="event-header event-header-clickable"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
            >
                <div className="event-header-left">
                    <Leaf size={20} className="event-icon" />
                    <span className="event-title">Inputs</span>
                    <span className="event-summary">
                        {sprays.length > 0 && <span className="inline-flex items-center gap-1 mr-2 text-purple-600"><SprayCan size={12} /> {sprays.length}</span>}
                        {nutrition.length > 0 && <span className="inline-flex items-center gap-1 text-emerald-600"><Leaf size={12} /> {nutrition.length}</span>}
                    </span>
                </div>
                <div className="event-header-right">
                    <span className="event-cost">{formatCurrency(inputs.totalCost)}</span>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
            </button>

            {isExpanded && (
                <div className="event-details">
                    {/* ── Spray Section ── */}
                    {sprays.length > 0 && (
                        <div className="mb-3">
                            <div className="flex items-center gap-2 mb-2 px-1">
                                <SprayCan size={14} className="text-purple-500" />
                                <span className="text-xs font-bold uppercase tracking-wider text-purple-600">Spray / फवारणी</span>
                                <span className="ml-auto text-xs font-semibold text-purple-500">{formatCurrency(sprayCost)}</span>
                            </div>
                            <div className="rounded-xl border border-purple-100 bg-purple-50/30 overflow-hidden">
                                {sprays.map((item, index) => (
                                    <div key={`spray-${index}`} className={`px-3 py-2.5 ${index > 0 ? 'border-t border-purple-100' : ''}`}>
                                        <div className="flex justify-between items-start">
                                            <span className="font-semibold text-sm text-stone-800">{item.name}</span>
                                            <span className="text-sm font-semibold text-purple-600">{formatCurrency(item.individualCost)}</span>
                                        </div>
                                        <div className="flex gap-2 mt-1">
                                            {item.quantity > 0 && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{item.quantity} {item.unit}</span>}
                                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{item.applicationMethod}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Nutrition Section ── */}
                    {nutrition.length > 0 && (
                        <div className="mb-3">
                            <div className="flex items-center gap-2 mb-2 px-1">
                                <Leaf size={14} className="text-emerald-500" />
                                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Nutrition / पोषण</span>
                                <span className="ml-auto text-xs font-semibold text-emerald-500">{formatCurrency(nutritionCost)}</span>
                            </div>
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 overflow-hidden">
                                {nutrition.map((item, index) => (
                                    <div key={`nutr-${index}`} className={`px-3 py-2.5 ${index > 0 ? 'border-t border-emerald-100' : ''}`}>
                                        <div className="flex justify-between items-start">
                                            <span className="font-semibold text-sm text-stone-800">{item.name}</span>
                                            <span className="text-sm font-semibold text-emerald-600">{formatCurrency(item.individualCost)}</span>
                                        </div>
                                        <div className="flex gap-2 mt-1">
                                            {item.quantity > 0 && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{item.quantity} {item.unit}</span>}
                                            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{item.applicationMethod}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="detail-row detail-row-total">
                        <span className="detail-label-bold">Inputs Subtotal</span>
                        <span className="detail-value-bold">{formatCurrency(inputs.totalCost)}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InputsEventCard;
