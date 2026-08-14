import {
    NoOwnedFileCacheError,
    openOwnedLocalFileCache,
    ownedLocalFileCacheName,
} from './localFileCache';

export interface FilePickResult {
    localPath?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    file: Blob;
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
    readFile(localPath: string): Promise<Blob>;
    deleteFile(localPath: string): Promise<void>;
}

const LOCAL_FILE_PATH_PREFIX = '/__agrisync_local_files__/';

function sanitizeFileName(fileName: string): string {
    const trimmed = fileName.trim();
    if (trimmed.length === 0) {
        return 'attachment.bin';
    }

    return trimmed
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 120);
}

function normalizeAccept(accept?: string[]): string {
    if (!accept || accept.length === 0) {
        return '*/*';
    }

    return accept.join(',');
}

function toBlob(data: Blob | ArrayBuffer, mimeType: string): Blob {
    if (data instanceof Blob) {
        if (data.type && data.type.length > 0) {
            return data;
        }

        return new Blob([data], { type: mimeType });
    }

    return new Blob([data], { type: mimeType });
}

async function promptForFile(accept: string): Promise<File> {
    return new Promise<File>((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input);

        input.onchange = () => {
            const selected = input.files?.[0];
            input.remove();
            if (!selected) {
                reject(new Error('No file selected.'));
                return;
            }

            resolve(selected);
        };

        input.oncancel = () => {
            input.remove();
            reject(new Error('File selection cancelled.'));
        };

        input.click();
    });
}

export class WebDeviceFilesService implements DeviceFilesService {
    async pickFile(accept?: string[]): Promise<FilePickResult> {
        const file = await promptForFile(normalizeAccept(accept));
        return {
            fileName: file.name || 'attachment.bin',
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            file,
        };
    }

    async saveFile(options: SaveFileOptions): Promise<string> {
        const fileName = sanitizeFileName(options.fileName);
        const blob = toBlob(options.data, options.mimeType);
        const localPath = `${LOCAL_FILE_PATH_PREFIX}${crypto.randomUUID()}-${fileName}`;

        if (typeof caches === 'undefined') {
            return URL.createObjectURL(blob);
        }

        // P0.1: the bucket is chosen by the ownership boundary, never by a
        // constant. An unidentified session is refused here rather than writing
        // a farmer-shaped file into a bucket nobody owns.
        const cache = await openOwnedLocalFileCache('save');
        await cache.put(
            localPath,
            new Response(blob, {
                headers: {
                    'content-type': options.mimeType,
                },
            }),
        );

        return localPath;
    }

    async readFile(localPath: string): Promise<Blob> {
        if (localPath.startsWith('blob:') || localPath.startsWith('data:') || localPath.startsWith('http')) {
            const response = await fetch(localPath);
            if (!response.ok) {
                throw new Error(`Unable to read file from '${localPath}'.`);
            }

            return response.blob();
        }

        if (typeof caches === 'undefined') {
            throw new Error('CacheStorage is unavailable; cannot read local attachment file.');
        }

        // P0.1: reads the CURRENT farmer's bucket and only that one. There is
        // no fallback to the shared bucket — a miss is a miss, because the
        // alternative is farmer B pulling farmer A's bytes by holding a path.
        const cache = await openOwnedLocalFileCache('read');
        const cachedResponse = await cache.match(localPath);
        if (!cachedResponse) {
            throw new Error(`Local attachment file not found at '${localPath}'.`);
        }

        return cachedResponse.blob();
    }

    async deleteFile(localPath: string): Promise<void> {
        if (localPath.startsWith('blob:')) {
            URL.revokeObjectURL(localPath);
            return;
        }

        if (typeof caches === 'undefined') {
            return;
        }

        // P0.1: a session with no farmer deletes nothing. This is the one call
        // that could destroy another farmer's media, so it refuses quietly
        // rather than throwing — the callers are clean-up paths, and a throw
        // here would abort a queue drain over a file it was never allowed to
        // touch in the first place.
        if (ownedLocalFileCacheName() === null) {
            console.warn(new NoOwnedFileCacheError('delete').message, { localPath });
            return;
        }

        const cache = await openOwnedLocalFileCache('delete');
        await cache.delete(localPath);
    }
}

export const webDeviceFilesService = new WebDeviceFilesService();
