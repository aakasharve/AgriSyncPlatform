/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ChevronDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useUiPref } from '../../hooks/useUiPref';

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
 * Reusable accordion wrapper for Reflect page sections.
 *
 * State persists through useUiPref → Dexie's uiPrefs table (Sub-plan 04
 * Task 3 architecture). Initial render shows defaultOpen as the fallback;
 * the persisted value swaps in once Dexie load resolves. When `collapsible`
 * is false the section is always open and the persisted value is ignored.
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
    const [persistedOpen, setPersistedOpen] = useUiPref<boolean>(`collapsible-${id}`, defaultOpen);
    // When the section is non-collapsible, force-open regardless of stored value.
    const isOpen = collapsible ? persistedOpen : true;

    const toggleOpen = () => {
        if (!collapsible) return;
        setPersistedOpen(!isOpen);
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
