/**
 * OfflineEmptyState — Reusable offline/empty state component
 *
 * Displays a centered message with icon when offline or no data.
 * Configurable icon, message, and CTA button.
 */

import React from 'react';
import { WifiOff } from 'lucide-react';

interface OfflineEmptyStateProps {
     icon?: React.ReactNode;
     title?: string;
     message?: string;
     ctaLabel?: string;
     onCta?: () => void;
     variant?: 'offline' | 'empty';
}

const OfflineEmptyState: React.FC<OfflineEmptyStateProps> = ({
     icon,
     title,
     message,
     ctaLabel,
     onCta,
     variant = 'empty',
}) => {
     const isOffline = variant === 'offline';
     const defaultIcon = isOffline
          ? <WifiOff size={40} className="text-slate-300" />
          : icon || <div className="text-4xl">📋</div>;
     const defaultTitle = isOffline ? "You're Offline" : title || 'Nothing Here Yet';
     const defaultMessage = isOffline
          ? 'Your data is safe on your phone. It will sync when you reconnect.'
          : message || 'Get started by adding your first entry.';

     return (
          <div className="flex flex-col items-center justify-center text-center p-10 py-16">
               <div className="w-20 h-20 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 flex items-center justify-center mb-5">
                    {defaultIcon}
               </div>
               <h3 className="font-bold text-slate-600 text-lg mb-2">
                    {defaultTitle}
               </h3>
               <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-5">
                    {defaultMessage}
               </p>
               {ctaLabel && onCta && (
                    <button
                         onClick={onCta}
                         className="px-6 py-3 bg-emerald-600 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-200 active:bg-emerald-700 transition-colors"
                    >
                         {ctaLabel}
                    </button>
               )}
          </div>
     );
};

export default OfflineEmptyState;
