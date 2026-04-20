import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * OfflineBanner — Fixed banner at top of screen when offline.
 *
 * Subtle amber background. Auto-dismisses when back online.
 * Does NOT block any user action.
 */
const OfflineBanner: React.FC = () => {
     const [isOffline, setIsOffline] = useState(!navigator.onLine);

     useEffect(() => {
          const handleOffline = () => setIsOffline(true);
          const handleOnline = () => setIsOffline(false);

          window.addEventListener('offline', handleOffline);
          window.addEventListener('online', handleOnline);

          return () => {
               window.removeEventListener('offline', handleOffline);
               window.removeEventListener('online', handleOnline);
          };
     }, []);

     if (!isOffline) return null;

     return (
          <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 px-4 py-2 pt-safe-area pl-safe-area pr-safe-area text-white flex items-center justify-center gap-2 animate-in slide-in-from-top-2 shadow-md">
               <WifiOff size={14} />
               <span className="text-xs font-bold">You're offline. Changes saved locally.</span>
          </div>
     );
};

export default OfflineBanner;
