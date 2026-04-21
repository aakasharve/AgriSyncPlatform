import React from 'react';

type Severity = 'Info' | 'Watch' | 'NeedsAttention' | 'Critical';

interface SeverityPillProps {
    severity: Severity;
}

const config: Record<Severity, { label: string; labelMr: string; className: string }> = {
    Critical: {
        label: 'Critical',
        labelMr: 'गंभीर',
        className: 'bg-rose-100 text-rose-700 border border-rose-200',
    },
    NeedsAttention: {
        label: 'Needs Attention',
        labelMr: 'लक्ष द्या',
        className: 'bg-amber-100 text-amber-700 border border-amber-200',
    },
    Watch: {
        label: 'Watch',
        labelMr: 'नजर ठेवा',
        className: 'bg-stone-100 text-stone-600 border border-stone-200',
    },
    Info: {
        label: 'Info',
        labelMr: 'माहिती',
        className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    },
};

const SeverityPill: React.FC<SeverityPillProps> = ({ severity }) => {
    const { label, labelMr, className } = config[severity] ?? config.Watch;

    return (
        <span className={`inline-flex flex-col items-center rounded-full px-2.5 py-0.5 ${className}`}>
            <span style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-[10px] font-semibold leading-tight">{labelMr}</span>
            <span style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-[8px] opacity-70 leading-tight">{label}</span>
        </span>
    );
};

export default SeverityPill;
