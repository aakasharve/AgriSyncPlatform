/**
 * VerificationTimeline — Displays chronological verification events for a log
 *
 * Shows state transitions with actor, timestamp, and reason.
 * Data comes from VerificationEventDto[] synced from backend.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { VerificationEventDto } from '../../../../infrastructure/api/AgriSyncClient';

interface VerificationTimelineProps {
     events: VerificationEventDto[];
     collapsed?: boolean;
}

function formatRelativeTime(isoString: string): string {
     const now = Date.now();
     const then = new Date(isoString).getTime();
     const diffMs = now - then;
     const diffMins = Math.floor(diffMs / 60000);
     const diffHours = Math.floor(diffMs / 3600000);
     const diffDays = Math.floor(diffMs / 86400000);

     if (diffMins < 1) return 'Just now';
     if (diffMins < 60) return `${diffMins}m ago`;
     if (diffHours < 24) return `${diffHours}h ago`;
     if (diffDays < 7) return `${diffDays}d ago`;
     return new Date(isoString).toLocaleDateString();
}

function getStatusLabel(status: string): string {
     const labels: Record<string, string> = {
          draft: 'Draft',
          confirmed: 'Confirmed',
          verified: 'Verified',
          disputed: 'Disputed',
          correction_pending: 'Correction Pending',
     };
     return labels[status] || status;
}

function getStatusColor(status: string): string {
     const colors: Record<string, string> = {
          draft: 'bg-slate-400',
          confirmed: 'bg-blue-500',
          verified: 'bg-emerald-500',
          disputed: 'bg-red-500',
          correction_pending: 'bg-amber-500',
     };
     return colors[status] || 'bg-slate-400';
}

const VerificationTimeline: React.FC<VerificationTimelineProps> = ({
     events,
     collapsed = true,
}) => {
     const [isExpanded, setIsExpanded] = useState(!collapsed);

     if (!events || events.length === 0) return null;

     const sortedEvents = [...events].sort(
          (a, b) => new Date(b.occurredAtUtc).getTime() - new Date(a.occurredAtUtc).getTime()
     );

     return (
          <div className="mt-3">
               <button
                    onClick={(e) => {
                         e.stopPropagation();
                         setIsExpanded(!isExpanded);
                    }}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors"
               >
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {events.length} verification event{events.length !== 1 ? 's' : ''}
               </button>

               {isExpanded && (
                    <div className="mt-2 ml-1 border-l-2 border-slate-100 pl-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
                         {sortedEvents.map((event) => (
                              <div key={event.id} className="relative">
                                   {/* Timeline dot */}
                                   <div className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${getStatusColor(event.status)}`} />

                                   <div>
                                        <div className="flex items-center gap-2">
                                             <span className="text-[11px] font-bold text-slate-700">
                                                  {getStatusLabel(event.status)}
                                             </span>
                                             <span className="text-[10px] text-slate-400">
                                                  {formatRelativeTime(event.occurredAtUtc)}
                                             </span>
                                        </div>

                                        <p className="text-[10px] text-slate-400">
                                             by {event.verifiedByUserId.substring(0, 8)}...
                                        </p>

                                        {event.reason && (
                                             <p className="text-[11px] text-slate-600 bg-slate-50 rounded-md px-2 py-1 mt-1 border border-slate-100">
                                                  "{event.reason}"
                                             </p>
                                        )}
                                   </div>
                              </div>
                         ))}
                    </div>
               )}
          </div>
     );
};

export default VerificationTimeline;
