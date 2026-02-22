export interface CaptureResult {
    file: Blob;
    fileName: string;
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

function createInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    return input;
}

async function promptForImage(captureMode?: 'environment'): Promise<File> {
    return new Promise<File>((resolve, reject) => {
        const input = createInput();
        if (captureMode) {
            input.setAttribute('capture', captureMode);
        }

        input.onchange = () => {
            const selected = input.files?.[0];
            input.remove();
            if (!selected) {
                reject(new Error('No image selected.'));
                return;
            }

            resolve(selected);
        };

        input.oncancel = () => {
            input.remove();
            reject(new Error('Image selection cancelled.'));
        };

        input.click();
    });
}

async function getImageDimensions(blob: Blob): Promise<{ width?: number; height?: number }> {
    if (typeof Image === 'undefined' || typeof URL === 'undefined') {
        return {};
    }

    const objectUrl = URL.createObjectURL(blob);

    try {
        return await new Promise<{ width?: number; height?: number }>((resolve) => {
            const image = new Image();
            image.onload = () => {
                resolve({
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                });
            };
            image.onerror = () => resolve({});
            image.src = objectUrl;
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function toCaptureResult(file: File): Promise<CaptureResult> {
    const dimensions = await getImageDimensions(file);
    return {
        file,
        fileName: file.name || `capture-${Date.now()}.jpg`,
        mimeType: file.type || 'image/jpeg',
        sizeBytes: file.size,
        ...dimensions,
    };
}

export class WebDeviceCameraService implements DeviceCameraService {
    async isAvailable(): Promise<boolean> {
        return typeof document !== 'undefined' && typeof window !== 'undefined';
    }

    async capturePhoto(): Promise<CaptureResult> {
        const file = await promptForImage('environment');
        return toCaptureResult(file);
    }

    async pickFromGallery(): Promise<CaptureResult> {
        const file = await promptForImage();
        return toCaptureResult(file);
    }
}

export const webDeviceCameraService = new WebDeviceCameraService();
