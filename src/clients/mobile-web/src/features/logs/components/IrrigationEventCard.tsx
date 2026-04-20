/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Droplets, ChevronDown, ChevronUp } from 'lucide-react';
import { IrrigationEvent } from '../../../types';
import { formatCurrency } from '../../../shared/utils/currency';

export interface IrrigationSummary {
    isEmpty: boolean;
    occurred: boolean;
    method: string;
    durationHours: number;
    source: string;
    cost: number;
}

interface IrrigationEventCardProps {
    irrigation: IrrigationSummary;
}

/**
 * Irrigation Event Card
 * 
 * At-a-glance: "Irrigation · Drip · 2 hours · ₹0"
 * IMPORTANT: Shows even if irrigation was "planned/default"
 */
const IrrigationEventCard: React.FC<IrrigationEventCardProps> = ({ irrigation }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (irrigation.isEmpty || !irrigation.occurred) {
        return (
            <div className="event-card event-card-empty">
                <div className="event-header">
                    <Droplets size={20} className="event-icon" />
                    <span className="event-title">Irrigation</span>
                </div>
                <p className="empty-state-text">No irrigation today</p>
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
                    <Droplets size={20} className="event-icon" />
                    <span className="event-title">Irrigation</span>
                    <span className="event-summary">
                        {irrigation.method} · {irrigation.durationHours}h
                    </span>
                </div>
                <div className="event-header-right">
                    <span className="event-cost">{formatCurrency(irrigation.cost)}</span>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
            </button>

            {isExpanded && (
                <div className="event-details">
                    <div className="detail-row">
                        <span className="detail-label">Method</span>
                        <span className="detail-value">{irrigation.method}</span>
                    </div>

                    <div className="detail-row">
                        <span className="detail-label">Water Source</span>
                        <span className="detail-value">{irrigation.source}</span>
                    </div>

                    <div className="detail-row">
                        <span className="detail-label">Duration</span>
                        <span className="detail-value">{irrigation.durationHours} hours</span>
                    </div>

                    <div className="detail-row">
                        <span className="detail-label">Direct Cost</span>
                        <span className="detail-value">{formatCurrency(irrigation.cost)}</span>
                    </div>

                    {irrigation.cost === 0 && (
                        <div className="detail-note">
                            <small>Electricity cost tracked separately in farm operations</small>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default IrrigationEventCard;
