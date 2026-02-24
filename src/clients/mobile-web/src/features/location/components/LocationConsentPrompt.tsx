/**
 * LocationConsentPrompt — GPS consent bottom sheet
 *
 * Shown on first GPS-requiring action. Non-blocking.
 * Three choices: Allow, Not Now, Never Ask Again.
 */

import React from 'react';
import { MapPin, X } from 'lucide-react';

interface LocationConsentPromptProps {
     isOpen: boolean;
     onAllow: () => void;
     onNotNow: () => void;
     onNeverAsk: () => void;
}

const LocationConsentPrompt: React.FC<LocationConsentPromptProps> = ({
     isOpen,
     onAllow,
     onNotNow,
     onNeverAsk,
}) => {
     if (!isOpen) return null;

     return (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
               {/* Backdrop */}
               <div
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in"
                    onClick={onNotNow}
               />

               {/* Sheet */}
               <div className="relative w-full max-w-md bg-white rounded-t-3xl shadow-2xl p-6 pb-8 animate-in slide-in-from-bottom-4 duration-300">
                    {/* Handle */}
                    <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />

                    {/* Close */}
                    <button
                         onClick={onNotNow}
                         className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 transition-colors"
                    >
                         <X size={18} className="text-slate-400" />
                    </button>

                    {/* Icon */}
                    <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                         <MapPin size={28} className="text-emerald-600" />
                    </div>

                    {/* Title */}
                    <h3 className="text-lg font-bold text-slate-900 text-center mb-2">
                         Share Your Location
                    </h3>

                    {/* Description */}
                    <p className="text-sm text-slate-500 text-center mb-6 leading-relaxed">
                         Share your location to prove where work happened.
                         This builds trust in your records.
                    </p>

                    {/* Buttons */}
                    <div className="space-y-2.5">
                         <button
                              onClick={onAllow}
                              className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-bold text-sm shadow-lg shadow-emerald-200 active:bg-emerald-700 transition-colors"
                         >
                              Allow Location
                         </button>

                         <button
                              onClick={onNotNow}
                              className="w-full py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold text-sm active:bg-slate-200 transition-colors"
                         >
                              Not Now
                         </button>

                         <button
                              onClick={onNeverAsk}
                              className="w-full py-2 text-xs text-slate-400 font-medium active:text-slate-600 transition-colors"
                         >
                              Never Ask Again
                         </button>
                    </div>
               </div>
          </div>
     );
};

export default LocationConsentPrompt;
