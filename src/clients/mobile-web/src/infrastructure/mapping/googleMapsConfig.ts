export const GOOGLE_MAPS_SCRIPT_ID = 'google-map-script';
export const GOOGLE_MAPS_LIBRARIES: ('drawing' | 'geometry')[] = ['drawing', 'geometry'];

interface ViteImportMeta {
    env?: {
        VITE_GOOGLE_MAPS_API_KEY?: unknown;
    };
}

export const getGoogleMapsApiKey = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_GOOGLE_MAPS_API_KEY;
    return typeof raw === 'string' ? raw.trim() : '';
};

