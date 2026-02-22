export interface LocationSnapshot {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  altitudeAccuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
  provider: 'gps' | 'network' | 'fused' | 'unknown';
}

export interface PermissionState {
  location: 'granted' | 'denied' | 'prompt';
}

export interface DeviceLocationService {
  checkPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  getCurrentPosition(highAccuracy?: boolean): Promise<LocationSnapshot>;
}
