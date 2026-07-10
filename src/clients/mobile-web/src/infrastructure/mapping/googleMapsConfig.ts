export const GOOGLE_MAPS_SCRIPT_ID = 'google-map-script';
// 'drawing' removed: google.maps.drawing.DrawingManager was dropped from the Maps JS
// API in v3.65. Boundary drawing is now done with tap-to-place-corners in GooglePlotMap
// (core Polygon/Polyline/Marker). 'geometry' stays for spherical area computation.
export const GOOGLE_MAPS_LIBRARIES: ('geometry')[] = ['geometry'];

interface ViteImportMeta {
    env?: {
        VITE_GOOGLE_MAPS_API_KEY?: unknown;
    };
}

export const getGoogleMapsApiKey = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_GOOGLE_MAPS_API_KEY;
    return typeof raw === 'string' ? raw.trim() : '';
};

