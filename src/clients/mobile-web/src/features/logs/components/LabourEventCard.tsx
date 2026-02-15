/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';
import { LabourEvent } from '../../../types';
import { formatCurrency } from '../../../shared/utils/costCalculations';

export interface LabourSummary {
    isEmpty: boolean;
    maleCount: number;
    femaleCount: number;
    maleRate: number;
    femaleRate: number;
    totalCost: number;
    hoursWorked: number;
}

interface LabourEventCardProps {
    labour: LabourSummary;
}

/**
 * Labour Event Card
 * 
 * At-a-glance: "Labour · 3 Male · 2 Female · ₹1,200"
 * Expanded: Breakdown of rates, hours, calculation
 */
const LabourEventCard: React.FC<LabourEventCardProps> = ({ labour }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (labour.isEmpty) {
        return (
            <div className="event-card event-card-empty">
                <div className="event-header">
                    <Users size={20} className="event-icon" />
                    <span className="event-title">Labour</span>
                </div>
                <p className="empty-state-text">No labour used today</p>
            </div>
        );
    }

    return (
        <div className="event-card">
            <button
                className="event-header event-header-clickable"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
            >
                <div className="event-header-left">
                    <Users size={20} className="event-icon" />
                    <span className="event-title">Labour</span>
                    <span className="event-summary">
                        {labour.maleCount > 0 && `${labour.maleCount} Male`}
                        {labour.maleCount > 0 && labour.femaleCount > 0 && ' · '}
                        {labour.femaleCount > 0 && `${labour.femaleCount} Female`}
                    </span>
                </div>
                <div className="event-header-right">
                    <span className="event-cost">{formatCurrency(labour.totalCost)}</span>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
            </button>

            {isExpanded && (
                <div className="event-details">
                    <div className="detail-row">
                        <span className="detail-label">Male Workers</span>
                        <span className="detail-value">
                            {labour.maleCount} × {formatCurrency(labour.maleRate)} = {formatCurrency(labour.maleCount * labour.maleRate)}
                        </span>
                    </div>

                    <div className="detail-row">
                        <span className="detail-label">Female Workers</span>
                        <span className="detail-value">
                            {labour.femaleCount} × {formatCurrency(labour.femaleRate)} = {formatCurrency(labour.femaleCount * labour.femaleRate)}
                        </span>
                    </div>

                    <div className="detail-row">
                        <span className="detail-label">Hours Worked</span>
                        <span className="detail-value">{labour.hoursWorked}h</span>
                    </div>

                    <div className="detail-row detail-row-total">
                        <span className="detail-label-bold">Labour Subtotal</span>
                        <span className="detail-value-bold">{formatCurrency(labour.totalCost)}</span>
                    </div>

                    <div className="detail-note">
                        <small>Rates sourced from Settings</small>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LabourEventCard;
