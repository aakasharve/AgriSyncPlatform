/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { formatCurrency } from '../../../shared/utils/currency';

interface CostSummaryCardProps {
    totalCost: number;
    date: string;
}

/**
 * Daily Cost Summary Card
 * 
 * The anchor component - Always visible at top.
 * Answers: "How much did this day cost?"
 */
const CostSummaryCard: React.FC<CostSummaryCardProps> = ({ totalCost, date }) => {
    return (
        <div className="cost-summary-card">
            <div className="cost-header">
                <h3 className="cost-label">Total Daily Cost</h3>
                <span className="cost-date">{new Date(date).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                })}</span>
            </div>
            <div className="cost-amount">
                {formatCurrency(totalCost)}
            </div>
            <div className="cost-context">
                <p className="cost-hint">Breakdown below shows exactly where this was spent</p>
            </div>
        </div>
    );
};

export default CostSummaryCard;
