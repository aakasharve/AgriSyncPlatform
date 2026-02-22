import type {
  DeviceLocationService,
  LocationSnapshot,
  PermissionState
} from '../DeviceLocationService';

type BrowserPermissionState = 'granted' | 'denied' | 'prompt';

export class WebLocationService implements DeviceLocationService {
  async checkPermission(): Promise<PermissionState> {
    if (typeof navigator === 'undefined') {
      return { location: 'denied' };
    }

    if (!navigator.permissions?.query) {
      return { location: 'prompt' };
    }

    try {
      const status = await navigator.permissions.query({
        name: 'geolocation'
      } as PermissionDescriptor);

      return { location: this.normalizePermission(status.state) };
    } catch {
      return { location: 'prompt' };
    }
  }

  async requestPermission(): Promise<PermissionState> {
    try {
      await this.getCurrentPosition(false);
      return { location: 'granted' };
    } catch {
      return { location: 'denied' };
    }
  }

  getCurrentPosition(highAccuracy = false): Promise<LocationSnapshot> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return Promise.reject(new Error('Geolocation is unavailable in this browser.'));
    }

    return new Promise<LocationSnapshot>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude ?? undefined,
            altitudeAccuracy: position.coords.altitudeAccuracy ?? undefined,
            heading: position.coords.heading ?? undefined,
            speed: position.coords.speed ?? undefined,
            timestamp: position.timestamp,
            provider: 'unknown'
          });
        },
        (error) => reject(new Error(error.message)),
        {
          enableHighAccuracy: highAccuracy,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }

  private normalizePermission(state: PermissionState['location'] | BrowserPermissionState): PermissionState['location'] {
    if (state === 'granted' || state === 'denied') {
      return state;
    }

    return 'prompt';
  }
}
