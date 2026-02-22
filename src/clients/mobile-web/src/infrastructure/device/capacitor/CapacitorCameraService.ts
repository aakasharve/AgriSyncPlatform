import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { CaptureResult, DeviceCameraService } from '../DeviceCameraService';

export class CapacitorCameraService implements DeviceCameraService {
  async isAvailable(): Promise<boolean> {
    return Capacitor.isPluginAvailable('Camera');
  }

  capturePhoto(): Promise<CaptureResult> {
    return this.capture(CameraSource.Camera);
  }

  pickFromGallery(): Promise<CaptureResult> {
    return this.capture(CameraSource.Photos);
  }

  private async capture(source: CameraSource): Promise<CaptureResult> {
    await this.ensurePermissions();

    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      correctOrientation: true,
      resultType: CameraResultType.Uri,
      source
    });

    const localPath = photo.path ?? photo.webPath;
    if (!localPath) {
      throw new Error('Camera did not return a file path.');
    }

    const metadata = await this.readMetadata(photo.webPath);

    return {
      localPath,
      mimeType: photo.format ? `image/${photo.format}` : 'image/jpeg',
      sizeBytes: metadata.sizeBytes,
      width: metadata.width,
      height: metadata.height
    };
  }

  private async ensurePermissions(): Promise<void> {
    const current = await Camera.checkPermissions();
    if (this.isGranted(current.camera) && this.isGranted(current.photos)) {
      return;
    }

    const requested = await Camera.requestPermissions({
      permissions: ['camera', 'photos']
    });

    if (!this.isGranted(requested.camera) || !this.isGranted(requested.photos)) {
      throw new Error('Camera permissions were not granted.');
    }
  }

  private isGranted(value?: string): boolean {
    return value === 'granted' || value === 'limited';
  }

  private async readMetadata(webPath?: string): Promise<{ sizeBytes: number; width?: number; height?: number }> {
    if (!webPath) {
      return { sizeBytes: 0 };
    }

    const response = await fetch(webPath);
    if (!response.ok) {
      return { sizeBytes: 0 };
    }

    const blob = await response.blob();
    const sizeBytes = blob.size;
    const dimensions = await this.readDimensionsFromBlob(blob).catch(() => undefined);

    return {
      sizeBytes,
      width: dimensions?.width,
      height: dimensions?.height
    };
  }

  private readDimensionsFromBlob(blob: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = () => {
        resolve({ width: image.width, height: image.height });
        URL.revokeObjectURL(objectUrl);
      };

      image.onerror = () => {
        reject(new Error('Unable to inspect image dimensions.'));
        URL.revokeObjectURL(objectUrl);
      };

      image.src = objectUrl;
    });
  }
}
