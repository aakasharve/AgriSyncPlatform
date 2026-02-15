/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Tractor, ChevronDown, ChevronUp } from 'lucide-react';
import { MachineryEvent } from '../../../types';
import { formatCurrency } from '../../../shared/utils/costCalculations';

export interface MachinerySummary {
    isEmpty: boolean;
    machineType: string;
    purpose: string;
    totalCost: number;
    fuelCost: number;
    rentalCost: number;
}

interface MachineryEventCardProps {
    machinery: MachinerySummary;
}

/**
 * Machinery Event Card
 * 
 * At-a-glance: "Machine · Tractor used for spray · ₹500"
 * Expanded: Fuel + Rental breakdown
 */
const MachineryEventCard: React.FC<MachineryEventCardProps> = ({ machinery }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (machinery.isEmpty) {
        return (
            <div className="event-card event-card-empty">
                <div className="event-header">
                    <Tractor size={20} className="event-icon" />
                    <span className="event-title">Machinery</span>
                </div>
                <p className="empty-state-text">Not used today</p>
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
                    <Tractor size={20} className="event-icon" />
                    <span className="event-title">Machinery</span>
                    <span className="event-summary">
                        {machinery.machineType} · {machinery.purpose}
                    </span>
                </div>
                <div className="event-header-right">
                    <span className="event-cost">{formatCurrency(machinery.totalCost)}</span>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
            </button>

            {isExpanded && (
                <div className="event-details">
                    <div className="detail-row">
                        <span className="detail-label">Machine Type</span>
                        <span className="detail-value">{machinery.machineType}</span>
                    </div>

                    <div className="detail-row">
                        <span className="detail-label">Purpose</span>
                        <span className="detail-value">{machinery.purpose}</span>
                    </div>

                    {machinery.fuelCost > 0 && (
                        <div className="detail-row">
                            <span className="detail-label">Fuel Cost</span>
                            <span className="detail-value">{formatCurrency(machinery.fuelCost)}</span>
                        </div>
                    )}

                    {machinery.rentalCost > 0 && (
                        <div className="detail-row">
                            <span className="detail-label">Rental Cost</span>
                            <span className="detail-value">{formatCurrency(machinery.rentalCost)}</span>
                        </div>
                    )}

                    <div className="detail-row detail-row-total">
                        <span className="detail-label-bold">Machinery Subtotal</span>
                        <span className="detail-value-bold">{formatCurrency(machinery.totalCost)}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MachineryEventCard;
