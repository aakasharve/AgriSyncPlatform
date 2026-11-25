import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

/**
 * OfflineBanner — Fixed banner at top of screen when offline.
 *
 * Subtle amber background. Auto-dismisses when back online.
 * Does NOT block any user action.
 */
const OFFLINE_WORDS = {
     mr: 'नेट नाही. फोनवर ठेवलेले बदल नेट आल्यावर पाठवले जातील.', // PROPOSED (Marathi)
     en: 'No internet. Changes kept on the phone will be sent when the internet is back.', // PROPOSED (English)
} as const;

const OfflineBanner: React.FC = () => {
     const language = useOptionalLanguage()?.language;
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

     // One language at a time (Marathi mode Marathi only, English mode English only). It promises only what the app does: a change the phone has
     // kept (the mutation queue) is sent once the internet is back; some answers need the internet and are simply not asked without it.
     const words = OFFLINE_WORDS[language === 'en' ? 'en' : 'mr'];
     return (
          <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 px-4 py-2 pt-safe-area pl-safe-area pr-safe-area text-white flex items-center justify-center gap-2 animate-in slide-in-from-top-2 shadow-md" data-testid="offline-banner">
               <WifiOff size={14} />
               <span className="text-xs font-bold" style={{ fontFamily: language === 'en' ? "'DM Sans', sans-serif" : "'Noto Sans Devanagari', sans-serif" }}>{words}</span>
          </div>
     );
};

export default OfflineBanner;
