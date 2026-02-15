/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LogAttribution Component
 *
 * Displays "Logged by" and "Verified by" information below log entries.
 * Resolves operator IDs to names from the farmer profile.
 */

import React from 'react';
import { User, CheckCircle, AlertCircle, Clock, Shield } from 'lucide-react';
import { LogVerificationStatus, FarmOperator, LogVerification, LogMeta } from '../../types';

interface LogAttributionProps {
    meta?: LogMeta;
    verification?: LogVerification;
    operators: FarmOperator[];
    compact?: boolean; // Single line vs detailed view
    className?: string;
}

const getOperatorName = (operatorId: string | undefined, operators: FarmOperator[]): string => {
    if (!operatorId) return 'Unknown';
    const operator = operators.find(op => op.id === operatorId);
    return operator?.name || operatorId;
};

const getVerificationBadge = (status: LogVerificationStatus) => {
    switch (status) {
        case LogVerificationStatus.VERIFIED:
            return { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Verified' };
        case LogVerificationStatus.CONFIRMED:
            return { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Awaiting Verification' };
        case LogVerificationStatus.DRAFT:
            return { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-50', label: 'Draft' };
        case LogVerificationStatus.DISPUTED:
            return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Disputed' };
        case LogVerificationStatus.CORRECTION_PENDING:
            return { icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50', label: 'Correction Pending' };
        // V1 statuses (deprecated but still supported for display)
        case LogVerificationStatus.APPROVED:
            return { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Approved' };
        case LogVerificationStatus.PENDING:
            return { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Pending' };
        case LogVerificationStatus.REJECTED:
            return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Rejected' };
        default:
            return { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-50', label: 'Unknown' };
    }
};

export const LogAttribution: React.FC<LogAttributionProps> = ({
    meta,
    verification,
    operators,
    compact = false,
    className = ''
}) => {
    const loggedBy = getOperatorName(meta?.createdByOperatorId, operators);
    const verifiedBy = verification?.verifiedByOperatorId
        ? getOperatorName(verification.verifiedByOperatorId, operators)
        : null;

    const badge = verification?.status
        ? getVerificationBadge(verification.status)
        : null;

    if (compact) {
        return (
            <div className={`flex items-center gap-2 text-xs text-stone-500 ${className}`}>
                <User size={12} className="text-stone-400" />
                <span>{loggedBy}</span>
                {badge && (
                    <>
                        <span className="text-stone-300">•</span>
                        <badge.icon size={12} className={badge.color} />
                        <span className={badge.color}>{badge.label}</span>
                    </>
                )}
            </div>
        );
    }

    return (
        <div className={`flex flex-col gap-1.5 text-xs ${className}`}>
            {/* Logged by */}
            <div className="flex items-center gap-2 text-stone-600">
                <div className="flex items-center gap-1.5">
                    <User size={14} className="text-stone-400" />
                    <span className="text-stone-400">Logged by:</span>
                </div>
                <span className="font-medium">{loggedBy}</span>
                {meta?.createdAtISO && (
                    <span className="text-stone-400 text-[10px]">
                        {new Date(meta.createdAtISO).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </span>
                )}
            </div>

            {/* Verification status */}
            {badge && (
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                        <Shield size={14} className="text-stone-400" />
                        <span className="text-stone-400">Status:</span>
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${badge.bg}`}>
                        <badge.icon size={12} className={badge.color} />
                        <span className={`font-medium ${badge.color}`}>{badge.label}</span>
                    </div>
                    {verifiedBy && (
                        <span className="text-stone-500">
                            by <span className="font-medium">{verifiedBy}</span>
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Compact inline badge for lists
 */
export const LogAttributionBadge: React.FC<{
    operatorId?: string;
    operators: FarmOperator[];
    verificationStatus?: LogVerificationStatus;
}> = ({ operatorId, operators, verificationStatus }) => {
    const name = getOperatorName(operatorId, operators);
    const badge = verificationStatus ? getVerificationBadge(verificationStatus) : null;

    return (
        <div className="inline-flex items-center gap-1.5 text-[10px] text-stone-500">
            <span className="bg-stone-100 px-1.5 py-0.5 rounded">{name}</span>
            {badge && (
                <span className={`px-1.5 py-0.5 rounded ${badge.bg} ${badge.color}`}>
                    {badge.label}
                </span>
            )}
        </div>
    );
};

export default LogAttribution;
