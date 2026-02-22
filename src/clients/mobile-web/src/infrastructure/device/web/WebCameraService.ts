import type { CaptureResult, DeviceCameraService } from '../DeviceCameraService';

export class WebCameraService implements DeviceCameraService {
  async isAvailable(): Promise<boolean> {
    return typeof document !== 'undefined';
  }

  capturePhoto(): Promise<CaptureResult> {
    return this.pickImage('image/*', 'environment');
  }

  pickFromGallery(): Promise<CaptureResult> {
    return this.pickImage('image/*');
  }

  private pickImage(accept: string, capture?: string): Promise<CaptureResult> {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('File input is unavailable in this environment.'));
    }

    return new Promise<CaptureResult>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      if (capture) {
        input.setAttribute('capture', capture);
      }

      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) {
          reject(new Error('No image selected.'));
          return;
        }

        const localPath = URL.createObjectURL(file);
        const dimensions = await this.readDimensions(localPath).catch(() => undefined);

        resolve({
          localPath,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          width: dimensions?.width,
          height: dimensions?.height
        });
      });

      input.click();
    });
  }

  private readDimensions(localPath: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.width, height: image.height });
      image.onerror = () => reject(new Error('Unable to read image dimensions.'));
      image.src = localPath;
    });
  }
}
