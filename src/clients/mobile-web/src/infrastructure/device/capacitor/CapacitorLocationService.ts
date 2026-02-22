import { Geolocation } from '@capacitor/geolocation';
import type {
  DeviceLocationService,
  LocationSnapshot,
  PermissionState
} from '../DeviceLocationService';

export class CapacitorLocationService implements DeviceLocationService {
  async checkPermission(): Promise<PermissionState> {
    const status = await Geolocation.checkPermissions();
    return { location: this.normalize(status.location) };
  }

  async requestPermission(): Promise<PermissionState> {
    const status = await Geolocation.requestPermissions();
    return { location: this.normalize(status.location) };
  }

  async getCurrentPosition(highAccuracy = false): Promise<LocationSnapshot> {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: highAccuracy,
      timeout: 15000,
      maximumAge: 0
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude ?? undefined,
      altitudeAccuracy: position.coords.altitudeAccuracy ?? undefined,
      heading: position.coords.heading ?? undefined,
      speed: position.coords.speed ?? undefined,
      timestamp: position.timestamp,
      provider: 'fused'
    };
  }

  private normalize(state?: string): PermissionState['location'] {
    if (state === 'granted' || state === 'denied') {
      return state;
    }
    return 'prompt';
  }
}
