// spec: 2026-08-25-prod-cutover-waves
//
// The ONE place the app opens the microphone. The OS permission is asked here, at
// the farmer's first mic tap, and never at app start: on Android the WebView turns
// getUserMedia into the RECORD_AUDIO prompt and resumes the very same call once the
// farmer taps Allow, so the first capture starts without a second tap.
//
// One defensive retry: if the first call is rejected with NotAllowedError but the
// permission now reads as granted (the grant landed after the rejection), start
// again once. A real denial reads as denied/prompt and is surfaced untouched so the
// caller can show its type-instead message; tapping again asks the OS again.

async function permissionReadsGranted(): Promise<boolean> {
    try {
        const permissions = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
        if (!permissions?.query) return false;
        const status = await permissions.query({ name: 'microphone' as PermissionName });
        return status.state === 'granted';
    } catch {
        // WebViews that refuse to answer: unknown is not granted, so no retry.
        return false;
    }
}

export async function acquireMicStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
    const media = navigator.mediaDevices;
    try {
        return await media.getUserMedia(constraints);
    } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === 'NotAllowedError' && await permissionReadsGranted()) {
            return await media.getUserMedia(constraints);
        }
        throw err;
    }
}
