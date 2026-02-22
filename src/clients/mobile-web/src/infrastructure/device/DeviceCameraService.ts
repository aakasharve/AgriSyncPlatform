export interface CaptureResult {
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface DeviceCameraService {
  isAvailable(): Promise<boolean>;
  capturePhoto(): Promise<CaptureResult>;
  pickFromGallery(): Promise<CaptureResult>;
}
