import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
     onSaveAnyway: () => void;
     onCancel: () => void;
}

/**
 * DuplicateWarning — Non-blocking banner shown when a potential duplicate expense is detected.
 *
 * Shows when backend flags `isPotentialDuplicate: true` or when local logic detects
 * a similar amount/vendor within the last 2 hours.
 */
const DuplicateWarning: React.FC<Props> = ({ onSaveAnyway, onCancel }) => {
     return (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 animate-in fade-in slide-in-from-top-4 shadow-md">
               <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                         <AlertTriangle size={20} className="text-amber-600" />
                    </div>
                    <div className="flex-1">
                         <h4 className="text-sm font-black text-amber-800 mb-1">Possible Duplicate</h4>
                         <p className="text-xs text-amber-700 font-medium leading-relaxed">
                              A similar expense was found within the last 2 hours. Are you sure this is a new entry?
                         </p>
                    </div>
                    <button onClick={onCancel} className="p-1 rounded-full hover:bg-amber-100 transition-colors">
                         <X size={14} className="text-amber-500" />
                    </button>
               </div>

               <div className="flex gap-2 mt-4">
                    <button
                         onClick={onCancel}
                         className="flex-1 py-2.5 text-amber-700 font-bold text-xs bg-white border border-amber-200 rounded-xl hover:bg-amber-50 transition-colors"
                    >
                         Cancel
                    </button>
                    <button
                         onClick={onSaveAnyway}
                         className="flex-1 py-2.5 bg-amber-600 text-white font-bold text-xs rounded-xl shadow-md shadow-amber-200 transition-all active:scale-[0.98]"
                    >
                         Save Anyway
                    </button>
               </div>
          </div>
     );
};

export default DuplicateWarning;
