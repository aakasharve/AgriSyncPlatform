import { Directory, Filesystem } from '@capacitor/filesystem';
import type {
  DeviceFilesService,
  FilePickResult,
  SaveFileOptions
} from '../DeviceFilesService';

export class CapacitorFilesService implements DeviceFilesService {
  pickFile(accept?: string[]): Promise<FilePickResult> {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('File input is unavailable in this environment.'));
    }

    return new Promise<FilePickResult>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = (accept && accept.length > 0) ? accept.join(',') : '*/*';

      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          reject(new Error('No file selected.'));
          return;
        }

        resolve({
          localPath: URL.createObjectURL(file),
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size
        });
      });

      input.click();
    });
  }

  async saveFile(options: SaveFileOptions): Promise<string> {
    const blob = options.data instanceof Blob
      ? options.data
      : new Blob([options.data], { type: options.mimeType });

    const base64Data = await this.blobToBase64(blob);
    const directory = this.mapDirectory(options.directory);
    const result = await Filesystem.writeFile({
      path: options.fileName,
      data: base64Data,
      directory,
      recursive: true
    });

    return result.uri;
  }

  async readFile(localPath: string): Promise<ArrayBuffer> {
    if (localPath.startsWith('blob:') || localPath.startsWith('http')) {
      const response = await fetch(localPath);
      if (!response.ok) {
        throw new Error(`Unable to read file from path: ${localPath}`);
      }
      return response.arrayBuffer();
    }

    const result = await Filesystem.readFile({ path: localPath });
    if (result.data instanceof Blob) {
      return result.data.arrayBuffer();
    }

    return this.base64ToArrayBuffer(result.data);
  }

  async deleteFile(localPath: string): Promise<void> {
    if (localPath.startsWith('blob:')) {
      URL.revokeObjectURL(localPath);
      return;
    }

    await Filesystem.deleteFile({ path: localPath });
  }

  async getFileInfo(localPath: string): Promise<{ exists: boolean; sizeBytes: number }> {
    if (localPath.startsWith('blob:') || localPath.startsWith('http')) {
      try {
        const response = await fetch(localPath);
        if (!response.ok) {
          return { exists: false, sizeBytes: 0 };
        }
        const blob = await response.blob();
        return { exists: true, sizeBytes: blob.size };
      } catch {
        return { exists: false, sizeBytes: 0 };
      }
    }

    try {
      const stat = await Filesystem.stat({ path: localPath });
      return { exists: true, sizeBytes: stat.size ?? 0 };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }

  private mapDirectory(directory?: SaveFileOptions['directory']): Directory {
    if (directory === 'cache') {
      return Directory.Cache;
    }

    return Directory.Documents;
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Unable to convert blob to base64.'));
          return;
        }

        const parts = result.split(',');
        resolve(parts.length > 1 ? parts[1] : result);
      };
      reader.onerror = () => reject(new Error('Unable to read blob as base64.'));
      reader.readAsDataURL(blob);
    });
  }

  private base64ToArrayBuffer(data: string): ArrayBuffer {
    const base64 = data.includes(',') ? data.split(',')[1] : data;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
