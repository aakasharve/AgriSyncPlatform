/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FileText } from 'lucide-react';
export interface NotesSummary {
    exists: boolean;
    content: string;
}

interface NotesEventCardProps {
    notes?: NotesSummary;
}

/**
 * Notes Event Card (Optional)
 * 
 * At-a-glance: "Notes · Preventive spray done"
 * Only shown if meaningful notes exist
 */
const NotesEventCard: React.FC<NotesEventCardProps> = ({ notes }) => {

    if (!notes || !notes.exists || !notes.content) {
        return null; // Don't render if no notes
    }

    return (
        <div className="event-card event-card-notes">
            <div className="event-header">
                <FileText size={20} className="event-icon" />
                <span className="event-title">Notes</span>
            </div>
            <div className="notes-content">
                <p>{notes.content}</p>
            </div>
        </div>
    );
};

export default NotesEventCard;
