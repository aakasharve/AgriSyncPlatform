/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface AccordionBlockProps {
    title: string;
    icon: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

const AccordionBlock: React.FC<AccordionBlockProps> = ({ title, icon, isOpen, onToggle, children }) => {
    return (
        <div className={`bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm transition-all duration-300 ${isOpen ? 'ring-2 ring-emerald-50' : ''}`}>
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between p-5 bg-white active:bg-slate-50"
            >
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {icon}
                    </div>
                    <h3 className={`text-lg font-bold ${isOpen ? 'text-slate-800' : 'text-slate-600'}`}>{title}</h3>
                </div>
                {isOpen ? <ChevronUp className="text-slate-400" /> : <ChevronDown className="text-slate-400" />}
            </button>
            {isOpen && <div className="border-t border-slate-100 animate-in slide-in-from-top-2 p-5 bg-slate-50/30">{children}</div>}
        </div>
    );
};

export default AccordionBlock;
