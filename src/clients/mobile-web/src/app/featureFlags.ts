interface ViteEnvShape {
    env?: Record<string, unknown>;
}

const readEnv = (key: string): string =>
    String(((import.meta as ViteEnvShape).env?.[key] ?? '')).trim().toLowerCase();

export const isVoiceDoomLoopDetectorEnabled = (): boolean =>
    !['0', 'false', 'off', 'no'].includes(readEnv('VITE_VOICE_DOOM_LOOP_DETECTOR'));
