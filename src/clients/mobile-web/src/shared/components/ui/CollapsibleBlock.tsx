/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown } from 'lucide-react';

interface CollapsibleBlockProps {
    id: string;
    title: string;
    icon?: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
    showReorder?: boolean;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    collapsible?: boolean;
}

/**
 * Collapsible Block Component
 * Reusable accordion wrapper for Reflect page sections
 */
const CollapsibleBlock: React.FC<CollapsibleBlockProps> = ({
    id,
    title,
    icon,
    defaultOpen = true,
    children,
    showReorder = false,
    canMoveUp = false,
    canMoveDown = false,
    onMoveUp,
    onMoveDown,
    collapsible = true
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    // Load saved state from localStorage
    useEffect(() => {
        if (!collapsible) {
            setIsOpen(true);
            return;
        }
        const saved = localStorage.getItem(`collapsible-${id}`);
        if (saved !== null) {
            setIsOpen(saved === 'true');
        }
    }, [id, collapsible]);

    // Save state to localStorage
    const toggleOpen = () => {
        if (!collapsible) return;
        const newState = !isOpen;
        setIsOpen(newState);
        localStorage.setItem(`collapsible-${id}`, String(newState));
    };

    return (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-200">
            {/* Header */}
            <div
                className={`p-5 flex items-center justify-between ${collapsible ? 'cursor-pointer hover:bg-slate-50' : ''} transition-colors ${!isOpen ? 'border-b-0' : 'border-b border-slate-100'
                    }`}
                onClick={toggleOpen}
            >
                <div className="flex items-center gap-3 flex-1">
                    {/* Reorder Controls */}
                    {showReorder && (
                        <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={onMoveUp}
                                disabled={!canMoveUp}
                                className={`p-0.5 rounded transition-colors ${canMoveUp
                                    ? 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                                    : 'text-slate-300 cursor-not-allowed'
                                    }`}
                                title="Move up"
                            >
                                <ArrowUp size={14} />
                            </button>
                            <button
                                onClick={onMoveDown}
                                disabled={!canMoveDown}
                                className={`p-0.5 rounded transition-colors ${canMoveDown
                                    ? 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                                    : 'text-slate-300 cursor-not-allowed'
                                    }`}
                                title="Move down"
                            >
                                <ArrowDown size={14} />
                            </button>
                        </div>
                    )}

                    {/* Icon */}
                    {icon && <div className="text-emerald-600">{icon}</div>}

                    {/* Title */}
                    <h2 className="text-xl font-bold text-slate-800">{title}</h2>
                </div>

                {/* Expand/Collapse Icon */}
                {collapsible && (
                    <div className="text-slate-400 transition-transform duration-200" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-180deg)' }}>
                        <ChevronDown size={24} />
                    </div>
                )}
            </div>

            {/* Content */}
            {isOpen && (
                <div className="p-5 pt-0 animate-in slide-in-from-top-2 duration-200">
                    {children}
                </div>
            )}
        </div>
    );
};

export default CollapsibleBlock;
