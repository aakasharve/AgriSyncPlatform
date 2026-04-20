/**
 * VerificationStatusBadge — Maps 5 backend verification states to visual chips
 *
 * States: draft, confirmed, verified, disputed, correction_pending
 * Replaces the generic "Pending" badge in DailyLogCard.
 */

import React from 'react';
import { PenLine, CheckCircle, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';

export type VerificationState = 'draft' | 'confirmed' | 'verified' | 'disputed' | 'correction_pending';

interface VerificationStatusBadgeProps {
     status?: string;
     size?: 'sm' | 'md';
}

const STATE_CONFIG: Record<VerificationState, { color: string; Icon: React.FC<{ size?: number }>; label: string }> = {
     draft: {
          color: 'bg-slate-100 text-slate-600 border-slate-200',
          Icon: PenLine,
          label: 'Draft',
     },
     confirmed: {
          color: 'bg-blue-50 text-blue-700 border-blue-200',
          Icon: CheckCircle,
          label: 'Confirmed',
     },
     verified: {
          color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          Icon: ShieldCheck,
          label: 'Verified',
     },
     disputed: {
          color: 'bg-red-50 text-red-700 border-red-200',
          Icon: AlertTriangle,
          label: 'Disputed',
     },
     correction_pending: {
          color: 'bg-amber-50 text-amber-700 border-amber-200',
          Icon: Clock,
          label: 'Correction Pending',
     },
};

function normalizeStatus(status?: string): VerificationState {
     if (!status) return 'draft';

     const normalized = status
          .trim()
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .replace(/[\s-]+/g, '_')
          .toLowerCase();

     switch (normalized) {
          case 'draft':
          case 'pending':
               return 'draft';
          case 'confirmed':
          case 'auto_approved':
               return 'confirmed';
          case 'verified':
          case 'approved':
               return 'verified';
          case 'disputed':
          case 'rejected':
               return 'disputed';
          case 'correction_pending':
               return 'correction_pending';
          default:
               return 'draft';
     }
}

const VerificationStatusBadge: React.FC<VerificationStatusBadgeProps> = ({
     status,
     size = 'sm',
}) => {
     const state = normalizeStatus(status);
     const config = STATE_CONFIG[state];
     const { Icon, color, label } = config;

     const sizeClasses = size === 'sm'
          ? 'text-[10px] px-2 py-0.5 gap-1'
          : 'text-xs px-2.5 py-1 gap-1.5';

     const iconSize = size === 'sm' ? 10 : 14;

     return (
          <span className={`inline-flex items-center font-bold rounded-full border ${color} ${sizeClasses}`}>
               <Icon size={iconSize} />
               {label}
          </span>
     );
};

export default VerificationStatusBadge;
export { normalizeStatus };
