/**
 * useLocationConsent — GPS consent state management
 *
 * Reads/writes gps_consent from Dexie appMeta table.
 * Non-blocking: never prevents user from completing an action.
 */

import { useState, useEffect, useCallback } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

export type ConsentState = 'granted' | 'denied' | 'prompt' | 'never';

const GPS_CONSENT_KEY = 'gps_consent';

interface ConsentRecord {
     decision: ConsentState;
     updatedAt: string;
}

export function useLocationConsent() {
     const [consentState, setConsentState] = useState<ConsentState>('prompt');
     const [showPrompt, setShowPrompt] = useState(false);

     useEffect(() => {
          let cancelled = false;
          const loadConsent = async () => {
               try {
                    const db = getDatabase();
                    const record = await db.appMeta.get(GPS_CONSENT_KEY);
                    if (!cancelled && record?.value) {
                         const consent = record.value as ConsentRecord;
                         setConsentState(consent.decision);
                    }
               } catch {
                    // Default to 'prompt' on error
               }
          };
          loadConsent();
          return () => { cancelled = true; };
     }, []);

     const saveConsent = useCallback(async (decision: ConsentState) => {
          try {
               const db = getDatabase();
               const record: ConsentRecord = {
                    decision,
                    updatedAt: new Date().toISOString(),
               };
               await db.appMeta.put({
                    key: GPS_CONSENT_KEY,
                    value: record,
                    updatedAt: new Date().toISOString(),
               });
               setConsentState(decision);
          } catch {
               // Silently fail, non-critical
          }
     }, []);

     const requestConsent = useCallback(async () => {
          if (consentState === 'prompt') {
               setShowPrompt(true);
          }
     }, [consentState]);

     const grantConsent = useCallback(async () => {
          // Try to request browser geolocation permission
          try {
               if (navigator.permissions) {
                    const result = await navigator.permissions.query({ name: 'geolocation' });
                    if (result.state === 'granted' || result.state === 'prompt') {
                         await saveConsent('granted');
                         setShowPrompt(false);
                         return;
                    }
               }
          } catch {
               // Fallback: just mark as granted, actual geolocation call will prompt
          }
          await saveConsent('granted');
          setShowPrompt(false);
     }, [saveConsent]);

     const denyConsent = useCallback(async () => {
          await saveConsent('denied');
          setShowPrompt(false);
     }, [saveConsent]);

     const neverAskAgain = useCallback(async () => {
          await saveConsent('never');
          setShowPrompt(false);
     }, [saveConsent]);

     const resetConsent = useCallback(async () => {
          await saveConsent('prompt');
     }, [saveConsent]);

     return {
          consentState,
          showPrompt,
          requestConsent,
          grantConsent,
          denyConsent,
          neverAskAgain,
          resetConsent,
     };
}
