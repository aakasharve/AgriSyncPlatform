/**
 * VerificationReasonInput — Text input for dispute/correction reasons
 *
 * Required for transitions to disputed or correction_pending states.
 * Max 500 characters.
 */

import React, { useState } from 'react';

interface VerificationReasonInputProps {
     placeholder?: string;
     onReasonChange: (reason: string) => void;
     required?: boolean;
     maxLength?: number;
}

const VerificationReasonInput: React.FC<VerificationReasonInputProps> = ({
     placeholder = 'Why is this wrong?',
     onReasonChange,
     required = true,
     maxLength = 500,
}) => {
     const [reason, setReason] = useState('');

     const handleChange = (value: string) => {
          const trimmed = value.slice(0, maxLength);
          setReason(trimmed);
          onReasonChange(trimmed);
     };

     return (
          <div className="mt-3 animate-in slide-in-from-bottom-2 duration-200">
               <textarea
                    value={reason}
                    onChange={(e) => handleChange(e.target.value)}
                    placeholder={placeholder}
                    rows={3}
                    className={`
                    w-full p-3 rounded-xl border text-sm outline-none transition-colors resize-none
                    ${required && reason.trim().length === 0
                              ? 'border-red-200 bg-red-50/30 focus:border-red-400'
                              : 'border-slate-200 bg-white focus:border-emerald-400'
                         }
                `}
               />
               <div className="flex justify-between items-center mt-1">
                    {required && reason.trim().length === 0 && (
                         <p className="text-[10px] text-red-500 font-medium">Reason is required</p>
                    )}
                    <p className={`text-[10px] ml-auto ${reason.length >= maxLength ? 'text-red-500' : 'text-slate-400'}`}>
                         {reason.length}/{maxLength}
                    </p>
               </div>
          </div>
     );
};

export default VerificationReasonInput;
