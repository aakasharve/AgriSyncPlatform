/**
 * useLocationCapture — GPS capture hook
 *
 * Wraps navigator.geolocation for web. Maps to backend LocationDto format.
 * Non-blocking: returns null if denied/timeout. Never prevents user actions.
 */

import { useState, useCallback } from 'react';
import type { LocationDto } from '../../../infrastructure/api/AgriSyncClient';
import { useLocationConsent } from './useLocationConsent';

const CAPTURE_TIMEOUT_MS = 10_000;

export function useLocationCapture() {
     const [isCapturing, setIsCapturing] = useState(false);
     const { consentState } = useLocationConsent();

     const captureLocation = useCallback(async (): Promise<LocationDto | null> => {
          // Non-blocking: if consent not granted, return null immediately
          if (consentState !== 'granted') {
               return null;
          }

          if (!navigator.geolocation) {
               return null;
          }

          setIsCapturing(true);

          try {
               const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(
                         resolve,
                         reject,
                         {
                              enableHighAccuracy: true,
                              timeout: CAPTURE_TIMEOUT_MS,
                              maximumAge: 60_000, // Accept cached position up to 1 min old
                         }
                    );
               });

               const dto: LocationDto = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracyMeters: position.coords.accuracy,
                    altitude: position.coords.altitude ?? undefined,
                    capturedAtUtc: new Date(position.timestamp).toISOString(),
                    provider: 'browser_geolocation',
                    permissionState: 'granted',
               };

               return dto;
          } catch {
               // Timeout, permission denied, or position unavailable — all non-blocking
               return null;
          } finally {
               setIsCapturing(false);
          }
     }, [consentState]);

     return {
          captureLocation,
          isCapturing,
     };
}
