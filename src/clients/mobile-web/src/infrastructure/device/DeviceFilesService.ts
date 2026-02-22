export interface FilePickResult {
  localPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SaveFileOptions {
  fileName: string;
  data: Blob | ArrayBuffer;
  mimeType: string;
  directory?: 'documents' | 'downloads' | 'cache';
}

export interface DeviceFilesService {
  pickFile(accept?: string[]): Promise<FilePickResult>;
  saveFile(options: SaveFileOptions): Promise<string>;
  readFile(localPath: string): Promise<ArrayBuffer>;
  deleteFile(localPath: string): Promise<void>;
  getFileInfo(localPath: string): Promise<{ exists: boolean; sizeBytes: number }>;
}
