/**
 * Thin-client fallback for patti extraction.
 * Image parsing must happen server-side; the frontend only forwards user flow.
 */

export const processPattiImage = async (
    _imageData: string,
    _mimeType: string,
    _cropName: string
): Promise<Record<string, unknown>> => {
    return {
        success: false,
        confidence: 0,
        warning: 'AI patti extraction is server-side only. Use manual entry.',
    };
};

