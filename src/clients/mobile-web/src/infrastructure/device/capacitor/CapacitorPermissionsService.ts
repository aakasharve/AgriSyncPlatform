import { Camera } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import type {
  DevicePermissionsService,
  PermissionStatus,
  PermissionType
} from '../DevicePermissionsService';

export class CapacitorPermissionsService implements DevicePermissionsService {
  async check(permission: PermissionType): Promise<PermissionStatus> {
    switch (permission) {
      case 'camera': {
        const status = await Camera.checkPermissions();
        return this.normalize(status.camera);
      }
      case 'location': {
        const status = await Geolocation.checkPermissions();
        return this.normalize(status.location);
      }
      case 'microphone':
        return this.checkMicrophonePermission();
      case 'storage':
      default:
        return 'granted';
    }
  }

  async request(permission: PermissionType): Promise<PermissionStatus> {
    switch (permission) {
      case 'camera': {
        const status = await Camera.requestPermissions({
          permissions: ['camera', 'photos']
        });
        return this.normalize(status.camera);
      }
      case 'location': {
        const status = await Geolocation.requestPermissions();
        return this.normalize(status.location);
      }
      case 'microphone':
        return this.requestMicrophonePermission();
      case 'storage':
      default:
        return 'granted';
    }
  }

  async openSettings(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.alert('Open device settings to update permissions.');
    }
  }

  private normalize(state?: string): PermissionStatus {
    if (state === 'granted' || state === 'denied' || state === 'prompt' || state === 'limited') {
      return state;
    }

    if (state === 'prompt-with-rationale') {
      return 'prompt';
    }

    return 'prompt';
  }

  private async checkMicrophonePermission(): Promise<PermissionStatus> {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      return 'prompt';
    }

    try {
      const status = await navigator.permissions.query({
        name: 'microphone'
      } as PermissionDescriptor);

      return this.normalize(status.state);
    } catch {
      return 'prompt';
    }
  }

  private async requestMicrophonePermission(): Promise<PermissionStatus> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'denied';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return 'granted';
    } catch {
      return 'denied';
    }
  }
}
