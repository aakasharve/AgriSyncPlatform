import React from 'react';
import { Check, X } from 'lucide-react';

export interface ComplianceBadgeProps {
    state: 'active' | 'none' | 'abandoned' | 'completed';
    compliancePct?: number; // 0-100
    size?: 'sm' | 'xs';
    onClick?: () => void;
}

export const ComplianceBadge: React.FC<ComplianceBadgeProps> = ({
    state,
    compliancePct,
    size = 'sm',
    onClick
}) => {
    const isSm = size === 'sm';
    const dim = isSm ? 'w-4 h-4' : 'w-3 h-3';
    
    let content = null;
    let containerClasses = `${dim} rounded-full flex items-center justify-center flex-shrink-0 cursor-help`;
    let title = '';

    if (state === 'none') {
        containerClasses += ' border border-dashed border-slate-400 bg-transparent';
        title = 'वेळापत्रक नाही';
    } else if (state === 'completed') {
        containerClasses += ' bg-slate-200 text-slate-600';
        content = <Check size={isSm ? 10 : 8} strokeWidth={3} />;
        title = 'पूर्ण झाले';
    } else if (state === 'abandoned') {
        containerClasses += ' bg-slate-200 text-slate-500';
        content = <X size={isSm ? 10 : 8} strokeWidth={3} />;
        title = 'सोडले';
    } else if (state === 'active') {
        const pct = compliancePct ?? 100;
        if (pct >= 70) {
            containerClasses += ' bg-green-500 shadow-sm shadow-green-500/30';
            title = `उत्तम (${Math.round(pct)}%)`;
        } else if (pct >= 40) {
            containerClasses += ' bg-amber-500 shadow-sm shadow-amber-500/30';
            title = `मध्यम (${Math.round(pct)}%)`;
        } else {
            containerClasses += ' bg-red-500 shadow-sm shadow-red-500/30';
            title = `कमी (${Math.round(pct)}%)`;
        }
    }

    return (
        <div 
            className={containerClasses} 
            title={title}
            onClick={(e) => {
                if (onClick) {
                    e.stopPropagation();
                    onClick();
                }
            }}
        >
            {content}
        </div>
    );
};

export default ComplianceBadge;
