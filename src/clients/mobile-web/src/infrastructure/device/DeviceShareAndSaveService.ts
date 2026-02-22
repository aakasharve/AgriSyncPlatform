export interface ShareOptions {
  title?: string;
  text?: string;
  url?: string;
  files?: { path: string; mimeType: string }[];
}

export interface DeviceShareAndSaveService {
  canShare(): Promise<boolean>;
  share(options: ShareOptions): Promise<void>;
  saveToDownloads(fileName: string, data: Blob, mimeType: string): Promise<string>;
}
