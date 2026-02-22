import type {
  DevicePermissionsService,
  PermissionStatus,
  PermissionType
} from '../DevicePermissionsService';

type PermissionNameLike = PermissionName | 'camera' | 'microphone';

export class WebPermissionsService implements DevicePermissionsService {
  async check(permission: PermissionType): Promise<PermissionStatus> {
    if (permission === 'storage') {
      return 'granted';
    }

    const permissionName = this.mapPermission(permission);
    if (!permissionName) {
      return 'prompt';
    }

    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      return 'prompt';
    }

    try {
      const result = await navigator.permissions.query({
        name: permissionName
      } as PermissionDescriptor);

      return this.normalize(result.state);
    } catch {
      return 'prompt';
    }
  }

  async request(permission: PermissionType): Promise<PermissionStatus> {
    switch (permission) {
      case 'location':
        return this.requestLocationPermission();
      case 'camera':
        return this.requestMediaPermission({ video: true });
      case 'microphone':
        return this.requestMediaPermission({ audio: true });
      case 'storage':
      default:
        return 'granted';
    }
  }

  async openSettings(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.alert('Open browser site settings to manage permissions.');
    }
  }

  private mapPermission(permission: PermissionType): PermissionNameLike | null {
    if (permission === 'location') {
      return 'geolocation';
    }
    if (permission === 'camera') {
      return 'camera';
    }
    if (permission === 'microphone') {
      return 'microphone';
    }
    return null;
  }

  private normalize(state: PermissionState | 'limited'): PermissionStatus {
    if (state === 'granted' || state === 'denied' || state === 'prompt') {
      return state;
    }
    return 'limited';
  }

  private requestLocationPermission(): Promise<PermissionStatus> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return Promise.resolve('denied');
    }

    return new Promise<PermissionStatus>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve('granted'),
        () => resolve('denied'),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  private async requestMediaPermission(constraints: MediaStreamConstraints): Promise<PermissionStatus> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'denied';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((track) => track.stop());
      return 'granted';
    } catch {
      return 'denied';
    }
  }
}
