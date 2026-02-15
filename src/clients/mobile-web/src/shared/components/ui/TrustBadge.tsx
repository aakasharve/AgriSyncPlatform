/**
 * TrustBadge Component
 * 
 * Displays the verification status of a log entry using the DFES Trust Ladder.
 * Part of the Week 1 Counter-Playbook sprint.
 * 
 * Trust Ladder:
 * - PENDING (Unverified) - Grey, needs review
 * - APPROVED (Verified) - Green, owner/mukadam confirmed
 * - REJECTED (Disputed) - Red, needs discussion
 * - AUTO_APPROVED - Blue, system auto-approved per policy
 */

import React from 'react';
import { LogVerificationStatus } from '../../../domain/types/log.types';
import { StatusBadge } from './StatusBadge';

interface TrustBadgeProps {
    status: LogVerificationStatus;
    size?: 'sm' | 'md';
    showLabel?: boolean;
}

/**
 * TrustBadge (Legacy/Wrapper)
 * 
 * Now just a wrapper around StatusBadge to ensure consistent V2 design
 * while maintaining backward compatibility for existing call sites.
 */
export const TrustBadge: React.FC<TrustBadgeProps> = ({
    status,
    size = 'sm',
    showLabel = false
}) => {
    return <StatusBadge status={status} size={size} showLabel={showLabel} />;
};

export default TrustBadge;
