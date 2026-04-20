import React from 'react';

interface AttentionRankPillProps {
    rank: string;
}

const rankConfig = {
    Critical: { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500', label: 'Critical' },
    NeedsAttention: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Needs Attention' },
    Watch: { bg: 'bg-stone-100', text: 'text-stone-600', dot: 'bg-stone-400', label: 'Watch' },
    Healthy: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Healthy' },
};

const AttentionRankPill: React.FC<AttentionRankPillProps> = ({ rank }) => {
    const config = rankConfig[rank as keyof typeof rankConfig] ?? rankConfig.Watch;
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${config.bg} ${config.text}`}
            style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
            <span className={`h-2 w-2 rounded-full ${config.dot}`} />
            {config.label}
        </span>
    );
};

export default AttentionRankPill;
