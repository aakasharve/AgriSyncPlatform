export type PermissionType = 'camera' | 'location' | 'storage' | 'microphone';
export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'limited';

export interface DevicePermissionsService {
  check(permission: PermissionType): Promise<PermissionStatus>;
  request(permission: PermissionType): Promise<PermissionStatus>;
  openSettings(): Promise<void>;
}
