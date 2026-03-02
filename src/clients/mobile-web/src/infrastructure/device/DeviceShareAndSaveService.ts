export interface DeviceShareAndSaveService {
    saveToDownloads(blob: Blob, fileName: string, mimeType?: string): Promise<void>;
    shareFile(
        blob: Blob,
        fileName: string,
        options?: { title?: string; text?: string; mimeType?: string },
    ): Promise<boolean>;
}

class WebDeviceShareAndSaveService implements DeviceShareAndSaveService {
    async saveToDownloads(blob: Blob, fileName: string, mimeType = 'application/pdf'): Promise<void> {
        const normalizedBlob = blob.type ? blob : new Blob([blob], { type: mimeType });
        const url = window.URL.createObjectURL(normalizedBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }

    async shareFile(
        blob: Blob,
        fileName: string,
        options?: { title?: string; text?: string; mimeType?: string },
    ): Promise<boolean> {
        const mimeType = options?.mimeType || 'application/pdf';
        const normalizedBlob = blob.type ? blob : new Blob([blob], { type: mimeType });
        const file = new File([normalizedBlob], fileName, { type: mimeType });

        if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: [file] })) {
            return false;
        }

        try {
            await navigator.share({
                files: [file],
                title: options?.title || 'Farm Report',
                text: options?.text,
            });
            return true;
        } catch {
            return false;
        }
    }
}

export const deviceShareAndSaveService: DeviceShareAndSaveService = new WebDeviceShareAndSaveService();
