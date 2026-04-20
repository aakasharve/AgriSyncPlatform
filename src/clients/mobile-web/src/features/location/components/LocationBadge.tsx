/**
 * LocationBadge — GPS trust badge for log/cost cards
 *
 * Shows green pin + "GPS" if location present.
 * Shows gray pin + "No GPS" otherwise.
 * Tappable to show coordinate details.
 */

import React, { useState } from 'react';
import { MapPin } from 'lucide-react';
import type { LocationDto } from '../../../infrastructure/api/AgriSyncClient';

interface LocationBadgeProps {
     location?: LocationDto | null;
}

const LocationBadge: React.FC<LocationBadgeProps> = ({ location }) => {
     const [showDetails, setShowDetails] = useState(false);

     const hasLocation = !!location;
     const accuracyLabel = location && location.accuracyMeters < 100
          ? `±${Math.round(location.accuracyMeters)}m`
          : null;

     return (
          <div className="relative inline-block">
               <button
                    onClick={(e) => {
                         e.stopPropagation();
                         if (hasLocation) setShowDetails(!showDetails);
                    }}
                    className={`
                    inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border transition-colors
                    ${hasLocation
                              ? 'bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-slate-50 border-slate-100 text-slate-400'}
                `}
               >
                    <MapPin size={10} />
                    <span>{hasLocation ? 'GPS' : 'No GPS'}</span>
                    {accuracyLabel && (
                         <span className="text-emerald-500">{accuracyLabel}</span>
                    )}
               </button>

               {/* Coordinate Popover */}
               {showDetails && location && (
                    <>
                         <div
                              className="fixed inset-0 z-40"
                              onClick={(e) => {
                                   e.stopPropagation();
                                   setShowDetails(false);
                              }}
                         />
                         <div className="absolute bottom-full left-0 mb-1 z-50 w-52 bg-white rounded-xl shadow-lg border border-slate-200 p-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
                              <div className="space-y-1.5">
                                   <div className="flex justify-between text-[11px]">
                                        <span className="text-slate-400">Lat</span>
                                        <span className="font-mono text-slate-700">{location.latitude.toFixed(6)}</span>
                                   </div>
                                   <div className="flex justify-between text-[11px]">
                                        <span className="text-slate-400">Lon</span>
                                        <span className="font-mono text-slate-700">{location.longitude.toFixed(6)}</span>
                                   </div>
                                   <div className="flex justify-between text-[11px]">
                                        <span className="text-slate-400">Accuracy</span>
                                        <span className="font-mono text-slate-700">{Math.round(location.accuracyMeters)}m</span>
                                   </div>
                                   {location.altitude !== undefined && (
                                        <div className="flex justify-between text-[11px]">
                                             <span className="text-slate-400">Alt</span>
                                             <span className="font-mono text-slate-700">{Math.round(location.altitude)}m</span>
                                        </div>
                                   )}
                                   <div className="flex justify-between text-[11px]">
                                        <span className="text-slate-400">Time</span>
                                        <span className="text-slate-600">
                                             {new Date(location.capturedAtUtc).toLocaleTimeString([], {
                                                  hour: '2-digit',
                                                  minute: '2-digit',
                                             })}
                                        </span>
                                   </div>
                                   <div className="flex justify-between text-[11px]">
                                        <span className="text-slate-400">Source</span>
                                        <span className="text-slate-600">{location.provider}</span>
                                   </div>
                              </div>
                         </div>
                    </>
               )}
          </div>
     );
};

export default LocationBadge;
