/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DayWorkSummary } from '../../../types';
import { formatCurrency } from '../../../shared/utils/costCalculations';
import { Users, Droplets, Tractor, Package, CheckSquare, FileText, User, ShieldCheck, Clock, SprayCan, Leaf } from 'lucide-react';

interface DailyWorkSummaryViewProps {
    summary: DayWorkSummary;
}

/**
 * Daily Work Summary View - SYMBOLIC & SCANNABLE VERSION
 * Compact, information-dense layout with activity chips
 */
const DailyWorkSummaryView: React.FC<DailyWorkSummaryViewProps> = ({ summary }) => {

    // Count active categories
    const activeCategories = [
        !summary.irrigation.isEmpty,
        !summary.labour.isEmpty,
        !summary.inputs.isEmpty,
        !summary.machinery.isEmpty,
        summary.notes?.exists
    ].filter(Boolean).length;

    // Split inputs into Spray and Nutrition
    const sprayItems = summary.inputs.items.filter(i => {
        const type = (i.inputType || '').toLowerCase();
        const method = (i.applicationMethod || '').toLowerCase();
        return method === 'spray' || type === 'pesticide' || type === 'fungicide';
    });

    // Everything else is nutrition (fertilizer, bio, etc.)
    const nutritionItems = summary.inputs.items.filter(i =>
        !sprayItems.includes(i)
    );

    const sprayCost = sprayItems.reduce((sum, i) => sum + i.individualCost, 0);
    const nutritionCost = nutritionItems.reduce((sum, i) => sum + i.individualCost, 0);

    return (
        <div className="space-y-4">

            {/* SYMBOLIC OVERVIEW - Activity Chips */}
            <div className="bg-gradient-to-br from-emerald-50 to-blue-50 rounded-2xl p-4 border-2 border-emerald-100">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Day Summary</h4>
                    <div className="flex items-center gap-1.5 bg-white/60 px-2 py-1 rounded-lg border border-emerald-100">
                        <img src="/assets/rupee_gold.png" alt="Total" className="w-5 h-5" />
                        <span className="text-lg font-mono font-bold text-emerald-700">{formatCurrency(summary.totalCost)}</span>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {/* NEW: Explicit Activity Titles */}
                    {summary.activities && summary.activities.titles.length > 0 && (
                        summary.activities.titles.map((title, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-200">
                                <CheckSquare size={14} strokeWidth={2.5} />
                                <span className="text-xs font-bold">{title}</span>
                            </div>
                        ))
                    )}

                    {!summary.irrigation.isEmpty && (
                        <div className="flex items-center gap-1.5 bg-blue-100 text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200">
                            <Droplets size={14} strokeWidth={2.5} />
                            <span className="text-xs font-bold">{summary.irrigation.durationHours}h Irrigation</span>
                        </div>
                    )}
                    {!summary.labour.isEmpty && (
                        <div className="flex items-center gap-1.5 bg-orange-100 text-orange-800 px-3 py-1.5 rounded-lg border border-orange-200">
                            <Users size={14} strokeWidth={2.5} />
                            <span className="text-xs font-bold">{summary.labour.maleCount + summary.labour.femaleCount} Workers</span>
                        </div>
                    )}
                    {!summary.inputs.isEmpty && (
                        <div className="flex items-center gap-1.5 bg-purple-100 text-purple-800 px-3 py-1.5 rounded-lg border border-purple-200">
                            <Package size={14} strokeWidth={2.5} />
                            <span className="text-xs font-bold">{summary.inputs.items.length} Input{summary.inputs.items.length > 1 ? 's' : ''}</span>
                        </div>
                    )}
                    {!summary.machinery.isEmpty && (
                        <div className="flex items-center gap-1.5 bg-slate-100 text-slate-800 px-3 py-1.5 rounded-lg border border-slate-200">
                            <Tractor size={14} strokeWidth={2.5} />
                            <span className="text-xs font-bold">Machinery</span>
                        </div>
                    )}
                    {summary.notes?.exists && (
                        <div className="flex items-center gap-1.5 bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg border border-amber-200">
                            <FileText size={14} strokeWidth={2.5} />
                            <span className="text-xs font-bold">Notes</span>
                        </div>
                    )}
                    {activeCategories === 0 && (!summary.activities || summary.activities.titles.length === 0) && (
                        <span className="text-xs text-slate-400 italic">No activity recorded</span>
                    )}
                </div>

                <div className="mt-3 pt-3 border-t border-emerald-200/50 text-xs text-slate-600 font-medium">
                    {new Date(summary.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
            </div>

            {/* COMPACT ACTIVITY DETAILS */}
            <div className="space-y-2">



                {/* Irrigation */}
                {!summary.irrigation.isEmpty && (
                    <div className="bg-white rounded-xl border-2 border-blue-100 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-blue-100 rounded-lg">
                                    <Droplets size={16} className="text-blue-700" strokeWidth={2.5} />
                                </div>
                                <span className="font-bold text-sm text-slate-800">Irrigation</span>
                            </div>
                            <span className="text-xs font-mono text-blue-700 font-bold">{formatCurrency(summary.irrigation.cost)}</span>
                        </div>
                        <div className="pl-8 text-sm text-slate-600">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400 uppercase">Method:</span>
                                <span>{summary.irrigation.method}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400 uppercase">Duration:</span>
                                <span>{summary.irrigation.durationHours} hours</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Labour */}
                {!summary.labour.isEmpty && (
                    <div className="bg-white rounded-xl border-2 border-orange-100 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-orange-100 rounded-lg">
                                    <Users size={16} className="text-orange-700" strokeWidth={2.5} />
                                </div>
                                <span className="font-bold text-sm text-slate-800">Labour</span>
                            </div>
                            <span className="text-xs font-mono text-orange-700 font-bold">{formatCurrency(summary.labour.totalCost)}</span>
                        </div>
                        <div className="pl-8 text-sm text-slate-600 space-y-0.5">
                            {summary.labour.maleCount > 0 && (
                                <div className="flex items-center justify-between">
                                    <span>Male: {summary.labour.maleCount} × {formatCurrency(summary.labour.maleRate)}</span>
                                    <span className="font-mono text-xs">{formatCurrency(summary.labour.maleCount * summary.labour.maleRate)}</span>
                                </div>
                            )}
                            {summary.labour.femaleCount > 0 && (
                                <div className="flex items-center justify-between">
                                    <span>Female: {summary.labour.femaleCount} × {formatCurrency(summary.labour.femaleRate)}</span>
                                    <span className="font-mono text-xs">{formatCurrency(summary.labour.femaleCount * summary.labour.femaleRate)}</span>
                                </div>
                            )}
                            <div className="text-xs text-slate-500 mt-1">
                                Hours worked: {summary.labour.hoursWorked}h
                            </div>
                        </div>
                    </div>
                )}

                {/* Spray Inputs */}
                {sprayItems.length > 0 && (
                    <div className="bg-white rounded-xl border-2 border-purple-100 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-purple-100 rounded-lg">
                                    <SprayCan size={16} className="text-purple-700" strokeWidth={2.5} />
                                </div>
                                <span className="font-bold text-sm text-slate-800">Spray Application</span>
                            </div>
                            <span className="text-xs font-mono text-purple-700 font-bold">{formatCurrency(sprayCost)}</span>
                        </div>
                        <div className="pl-8 space-y-2">
                            {sprayItems.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm">
                                    <div className="text-slate-700">
                                        <span className="font-medium">{item.name}</span>
                                        <span className="text-xs text-slate-500 ml-2">
                                            {item.quantity} {item.unit} · {item.applicationMethod || 'Spray'}
                                        </span>
                                    </div>
                                    <span className="font-mono text-xs text-slate-600">{formatCurrency(item.individualCost)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Nutrition Inputs */}
                {nutritionItems.length > 0 && (
                    <div className="bg-white rounded-xl border-2 border-emerald-100 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-emerald-100 rounded-lg">
                                    <Leaf size={16} className="text-emerald-700" strokeWidth={2.5} />
                                </div>
                                <span className="font-bold text-sm text-slate-800">Nutrition & Fertilizers</span>
                            </div>
                            <span className="text-xs font-mono text-emerald-700 font-bold">{formatCurrency(nutritionCost)}</span>
                        </div>
                        <div className="pl-8 space-y-2">
                            {nutritionItems.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm">
                                    <div className="text-slate-700">
                                        <span className="font-medium">{item.name}</span>
                                        <span className="text-xs text-slate-500 ml-2">
                                            {item.quantity} {item.unit} · {item.applicationMethod || 'Drip'}
                                        </span>
                                    </div>
                                    <span className="font-mono text-xs text-slate-600">{formatCurrency(item.individualCost)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Machinery */}
                {!summary.machinery.isEmpty && (
                    <div className="bg-white rounded-xl border-2 border-slate-200 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-slate-100 rounded-lg">
                                    <Tractor size={16} className="text-slate-700" strokeWidth={2.5} />
                                </div>
                                <span className="font-bold text-sm text-slate-800">Machinery</span>
                            </div>
                            <span className="text-xs font-mono text-slate-700 font-bold">{formatCurrency(summary.machinery.totalCost)}</span>
                        </div>
                        <div className="pl-8 text-sm text-slate-600 space-y-0.5">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400 uppercase">Type:</span>
                                <span>{summary.machinery.machineType}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400 uppercase">Purpose:</span>
                                <span>{summary.machinery.purpose}</span>
                            </div>
                            {summary.machinery.fuelCost > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                    <span>Fuel Cost:</span>
                                    <span className="font-mono">{formatCurrency(summary.machinery.fuelCost)}</span>
                                </div>
                            )}
                            {summary.machinery.rentalCost > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                    <span>Rental Cost:</span>
                                    <span className="font-mono">{formatCurrency(summary.machinery.rentalCost)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Notes */}
                {summary.notes?.exists && (
                    <div className="bg-amber-50 rounded-xl border-2 border-amber-200 p-3">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="p-1.5 bg-amber-100 rounded-lg">
                                <FileText size={16} className="text-amber-700" strokeWidth={2.5} />
                            </div>
                            <span className="font-bold text-sm text-amber-900">Notes</span>
                        </div>
                        <p className="pl-8 text-sm text-amber-800 leading-relaxed">
                            {summary.notes.content}
                        </p>
                    </div>
                )}

            </div>

            {/* ATTRIBUTION & METADATA */}
            {(summary.loggedBy || summary.verifiedBy) && (
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 mt-4 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-4">
                        {summary.loggedBy && (
                            <div className="flex items-center gap-1.5">
                                <User size={12} className="text-slate-400" />
                                <span>Logged by <span className="font-semibold text-slate-700">{summary.loggedBy}</span></span>
                            </div>
                        )}
                        {summary.loggedAt && (
                            <div className="flex items-center gap-1.5">
                                <Clock size={12} className="text-slate-400" />
                                <span>{new Date(summary.loggedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                            </div>
                        )}
                    </div>

                    {summary.verificationStatus === 'VERIFIED' && (
                        <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">
                            <ShieldCheck size={12} strokeWidth={2.5} />
                            <span className="font-bold">Verified {summary.verifiedBy ? `by ${summary.verifiedBy}` : ''}</span>
                        </div>
                    )}
                </div>
            )}

        </div>
    );
};

export default DailyWorkSummaryView;
