import React from 'react';

// --- ICONS ---
const Icons = {
    Saved: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <circle cx="5" cy="5" r="3" fill="currentColor" />
        </svg>
    ),
    Pending: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <circle cx="5" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" className="origin-center animate-spin-slow">
                {/* CSS animation is smoother than SVG animateTransform */}
            </circle>
        </svg>
    ),
    Synced: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M8 3L4 7L2 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    Conflict: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M5 2V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="5" cy="7.5" r="0.5" fill="currentColor" />
        </svg>
    )
};

interface SyncIndicatorProps {
    status: 'SAVED' | 'PENDING' | 'SYNCED' | 'CONFLICT';
    lastSyncedAt?: Date;
    onClick?: () => void;
}

export const SyncIndicator: React.FC<SyncIndicatorProps> = ({
    status,
    lastSyncedAt,
    onClick
}) => {
    const config = {
        SAVED: {
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
            Icon: Icons.Saved,
            label: 'Saved locally'
        },
        PENDING: {
            color: 'text-sky-600',
            bg: 'bg-sky-50',
            Icon: Icons.Pending,
            label: 'Syncing...'
        },
        SYNCED: {
            color: 'text-stone-400',
            bg: 'bg-transparent',
            Icon: Icons.Synced,
            label: lastSyncedAt ? `Synced ${lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Synced'
        },
        CONFLICT: {
            color: 'text-amber-600',
            bg: 'bg-amber-50',
            Icon: Icons.Conflict,
            label: 'Sync Issue'
        }
    }[status];

    const { Icon, color, bg, label } = config;

    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition-all duration-300 ${color} ${bg} hover:bg-opacity-80 active:scale-95`}
            aria-label={label}
        >
            <Icon className="w-2.5 h-2.5" />
            <span className="text-[10px] font-bold tracking-wide opacity-90">{label}</span>
        </button>
    );
};
