/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, LP-03; PLR-D5 "Back is ONE step: result ->
 * mic/plot -> crop") — the way out of the REVIEW of a parsed entry (I12-V1-M1).
 *
 * The review (ManualEntry, or the हजेरी door's AttendanceResult) has no back of its own. On the old
 * screen the crop carousel and the voice/हाताने toggle sat above it, so he could say it again or
 * change the plots; the entry flow took both away and left Save as the only exit. This puts the same
 * big labelled "मागे" on it: one step back to the mic of the SAME plots (the caller keeps the scope),
 * from where "मागे" goes on to the crop question and the work home. Android hardware Back does the
 * same step while the review is on screen.
 */
import React from 'react';
import FlowBackButton from '../../../context/components/FlowBackButton';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';

export const ReviewBackBar: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    useBackDismiss(true, onBack);
    return (
        <div className="flex items-center gap-2 px-3 pb-2 pt-2" data-testid="review-back-bar">
            <FlowBackButton onClick={onBack} testId="review-back" />
        </div>
    );
};

export default ReviewBackBar;
