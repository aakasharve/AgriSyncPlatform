import React from 'react';
import { LogVerificationStatus } from '../../../domain/types/log.types';
import { useLanguage } from '../../../i18n/LanguageContext';

// --- ICONS (Inline for zero-dependency) ---
const Icons = {
    Draft: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
    ),
    Confirmed: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <circle cx="6" cy="6" r="5" fill="currentColor" />
        </svg>
    ),
    Verified: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    Disputed: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M6 3V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="6" cy="9" r="1" fill="currentColor" />
        </svg>
    ),
    Pending: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
    )
};

interface StatusBadgeProps {
    status: LogVerificationStatus;
    size?: 'sm' | 'md';
    showLabel?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
    status,
    size = 'sm',
    showLabel = true
}) => {
    const { t } = useLanguage();
    const normalizedStatus = status === LogVerificationStatus.APPROVED
        ? LogVerificationStatus.VERIFIED
        : status === LogVerificationStatus.REJECTED
            ? LogVerificationStatus.DISPUTED
            : status === LogVerificationStatus.PENDING
                ? LogVerificationStatus.DRAFT
                : status === LogVerificationStatus.AUTO_APPROVED
                    ? LogVerificationStatus.CONFIRMED
                    : status;

    // Visual Config - tweaked for new "Agri-Tech" palette compatibility
    // Using explicit hex values where vars might be too generic, or vars where appropriate
    const config = {
        [LogVerificationStatus.DRAFT]: {
            label: t('dfes.waitingForConfirmation'),
            color: '#78716C', // stone-500
            bg: '#F5F5F4', // stone-100
            borderColor: '#E7E5E4', // stone-200
            Icon: Icons.Draft
        },
        [LogVerificationStatus.CONFIRMED]: {
            label: t('dfes.confirmed'),
            color: '#0369A1', // sky-700
            bg: '#E0F2FE', // sky-100
            borderColor: '#BAE6FD', // sky-200
            Icon: Icons.Confirmed
        },
        [LogVerificationStatus.VERIFIED]: {
            label: t('dfes.confirmed'),
            color: '#047857', // emerald-700
            bg: '#D1FAE5', // emerald-100
            borderColor: '#A7F3D0', // emerald-200
            Icon: Icons.Verified
        },
        [LogVerificationStatus.DISPUTED]: {
            label: t('dfes.ownerHasQuestion').replace('{owner}', 'Owner'),
            color: '#B45309', // amber-700
            bg: '#FEF3C7', // amber-100
            borderColor: '#FDE68A', // amber-200
            Icon: Icons.Disputed
        },
        [LogVerificationStatus.CORRECTION_PENDING]: {
            label: t('dfes.somethingNeedsFixing'),
            color: '#C2410C', // orange-700
            bg: '#FFEDD5', // orange-100
            borderColor: '#FED7AA', // orange-200
            Icon: Icons.Pending
        }
    }[normalizedStatus];

    // Fallback for unknown status
    const finalConfig = config || {
        label: status,
        color: '#78716C',
        bg: '#F5F5F4',
        borderColor: '#E7E5E4',
        Icon: Icons.Draft
    };

    const { Icon, label, color, bg, borderColor } = finalConfig;

    return (
        <div
            className={`inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-wide transition-all duration-200 hover:brightness-95 ${size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'
                }`}
            style={{
                backgroundColor: bg,
                color: color,
                border: `1px solid ${borderColor}`,
                boxShadow: `0 1px 2px ${color}15` // colored shadow based on status
            }}
        >
            <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} strokeWidth={2} />
            {showLabel && <span>{label}</span>}
        </div>
    );
};
