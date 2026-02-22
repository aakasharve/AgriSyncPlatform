import type {
  DeviceFilesService,
  FilePickResult,
  SaveFileOptions
} from '../DeviceFilesService';

export class WebFilesService implements DeviceFilesService {
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

    this.triggerDownload(options.fileName, blob);
    return options.fileName;
  }

  async readFile(localPath: string): Promise<ArrayBuffer> {
    const response = await fetch(localPath);
    if (!response.ok) {
      throw new Error(`Unable to read file from path: ${localPath}`);
    }

    const blob = await response.blob();
    return this.readBlobAsArrayBuffer(blob);
  }

  async deleteFile(localPath: string): Promise<void> {
    if (localPath.startsWith('blob:')) {
      URL.revokeObjectURL(localPath);
    }
  }

  async getFileInfo(localPath: string): Promise<{ exists: boolean; sizeBytes: number }> {
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

  private triggerDownload(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error('Unable to read file contents.'));
          return;
        }

        resolve(result);
      };
      reader.onerror = () => reject(new Error('Unable to read file contents.'));
      reader.readAsArrayBuffer(blob);
    });
  }
}
