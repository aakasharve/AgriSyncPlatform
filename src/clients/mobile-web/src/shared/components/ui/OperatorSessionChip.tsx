/**
 * OperatorSessionChip Component
 * 
 * Displays the current active operator and allows switching between operators.
 * Part of the Multi-Operator Reality (DFES Week 1 Counter-Playbook).
 * 
 * This component addresses the "shared device" reality where:
 * - Owner, Mukadam, and Workers share a single phone
 * - Each person should be attributed correctly for their logs
 * - Sessions expire at midnight to prevent wrong attribution
 */

import React, { useState } from 'react';
import { FarmOperator } from '../../../types';

interface OperatorSessionChipProps {
    currentOperator: FarmOperator | null;
    allOperators: FarmOperator[];
    onSwitchOperator: (operatorId: string) => void;
}

const roleLabels: Record<string, { label: string; labelMr: string }> = {
    'PRIMARY_OWNER': { label: 'Owner', labelMr: 'मालक' },
    'SECONDARY_OWNER': { label: 'Co-Owner', labelMr: 'सह-मालक' },
    'WORKER': { label: 'Worker', labelMr: 'कामगार' }
};

export const OperatorSessionChip: React.FC<OperatorSessionChipProps> = ({
    currentOperator,
    allOperators,
    onSwitchOperator
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const displayName = currentOperator?.name || 'Select Operator';
    const roleInfo = currentOperator?.role ? roleLabels[currentOperator.role] : null;

    return (
        <div className="relative">
            {/* Main Chip - Always Visible */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="
                    flex items-center gap-2 px-3 py-1.5 rounded-full
                    bg-amber-50 border border-amber-200
                    hover:bg-amber-100 transition-colors
                    text-sm font-medium text-amber-800
                "
            >
                {/* User Icon */}
                <span className="text-amber-600">👤</span>

                {/* Operator Name */}
                <span className="max-w-[120px] truncate">
                    {displayName}
                </span>

                {/* Role Badge (if available) */}
                {roleInfo && (
                    <span className="text-xs text-amber-600 hidden sm:inline">
                        ({roleInfo.label})
                    </span>
                )}

                {/* Dropdown Arrow */}
                <span className={`text-amber-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    ▾
                </span>
            </button>

            {/* Dropdown List */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Operator List */}
                    <div className="
                        absolute top-full right-0 mt-2 z-50
                        w-64 bg-white rounded-xl shadow-lg border border-slate-200
                        overflow-hidden
                    ">
                        {/* Header */}
                        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
                            <p className="text-xs text-slate-500 font-medium">
                                Switch Operator / चालक बदला
                            </p>
                        </div>

                        {/* Operator Options */}
                        <div className="max-h-64 overflow-y-auto">
                            {allOperators.length === 0 ? (
                                <div className="px-4 py-6 text-center text-slate-500 text-sm">
                                    <p>No operators added.</p>
                                    <p className="text-xs mt-1">Add operators in Settings.</p>
                                </div>
                            ) : (
                                allOperators.map((operator) => {
                                    const isActive = currentOperator?.id === operator.id;
                                    const opRoleInfo = roleLabels[operator.role] || { label: operator.role, labelMr: '' };

                                    return (
                                        <button
                                            key={operator.id}
                                            onClick={() => {
                                                onSwitchOperator(operator.id);
                                                setIsOpen(false);
                                            }}
                                            className={`
                                                w-full px-4 py-3 flex items-center gap-3
                                                hover:bg-slate-50 transition-colors text-left
                                                ${isActive ? 'bg-emerald-50' : ''}
                                            `}
                                        >
                                            {/* Avatar Placeholder */}
                                            <div className={`
                                                w-8 h-8 rounded-full flex items-center justify-center
                                                text-white font-bold text-sm
                                                ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}
                                            `}>
                                                {operator.name.charAt(0).toUpperCase()}
                                            </div>

                                            {/* Name + Role */}
                                            <div className="flex-1 min-w-0">
                                                <p className={`font-medium truncate ${isActive ? 'text-emerald-700' : 'text-slate-800'}`}>
                                                    {operator.name}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {opRoleInfo.label}
                                                </p>
                                            </div>

                                            {/* Active Check */}
                                            {isActive && (
                                                <span className="text-emerald-500 font-bold">✓</span>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default OperatorSessionChip;
