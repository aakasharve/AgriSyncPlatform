import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type {
  DeviceShareAndSaveService,
  ShareOptions
} from '../DeviceShareAndSaveService';

export class CapacitorShareAndSaveService implements DeviceShareAndSaveService {
  async canShare(): Promise<boolean> {
    const result = await Share.canShare();
    return result.value;
  }

  async share(options: ShareOptions): Promise<void> {
    await Share.share({
      title: options.title,
      text: options.text,
      url: options.url,
      files: options.files?.map((file) => file.path)
    });
  }

  async saveToDownloads(fileName: string, data: Blob, _mimeType: string): Promise<string> {
    const base64Data = await this.blobToBase64(data);
    const result = await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true
    });

    return result.uri;
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
}
