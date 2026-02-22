import type {
  DeviceShareAndSaveService,
  ShareOptions
} from '../DeviceShareAndSaveService';

export class WebShareAndSaveService implements DeviceShareAndSaveService {
  async canShare(): Promise<boolean> {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  async share(options: ShareOptions): Promise<void> {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const payload: ShareData = {
        title: options.title,
        text: options.text,
        url: options.url
      };

      if (options.files && options.files.length > 0 && typeof navigator.canShare === 'function') {
        const files = await this.resolveFiles(options.files);
        if (files.length > 0 && navigator.canShare({ files })) {
          payload.files = files;
        }
      }

      await navigator.share(payload);
      return;
    }

    if (options.files && options.files.length > 0) {
      const firstFile = options.files[0];
      const response = await fetch(firstFile.path);
      const blob = await response.blob();
      await this.saveToDownloads(this.extractFileName(firstFile.path), blob, firstFile.mimeType);
      return;
    }

    if (options.url && typeof window !== 'undefined') {
      window.open(options.url, '_blank');
      return;
    }

    throw new Error('Web Share API is unavailable and no fallback is possible.');
  }

  async saveToDownloads(fileName: string, data: Blob, _mimeType: string): Promise<string> {
    const url = URL.createObjectURL(data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    return fileName;
  }

  private async resolveFiles(files: { path: string; mimeType: string }[]): Promise<File[]> {
    const resolvedFiles: File[] = [];

    for (const file of files) {
      const response = await fetch(file.path);
      if (!response.ok) {
        continue;
      }

      const blob = await response.blob();
      resolvedFiles.push(new File([blob], this.extractFileName(file.path), { type: file.mimeType }));
    }

    return resolvedFiles;
  }

  private extractFileName(path: string): string {
    const cleaned = path.split('?')[0];
    const segments = cleaned.split('/');
    return segments[segments.length - 1] || 'download';
  }
}
