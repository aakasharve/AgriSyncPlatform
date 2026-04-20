import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioData } from '../../../types';
import { DEFAULT_VOICE_CONFIG } from '../../../infrastructure/voice/types';
import {
    createSilenceDetector,
    SilenceDetectorHandle,
} from '../../../infrastructure/voice/SilenceDetectorWorklet';

interface UseMediaRecorderResult {
    isRecording: boolean;
    duration: number;
    error: string | null;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    cancelRecording: () => void;
}

interface UseMediaRecorderProps {
    onAudioCaptured: (audioData: AudioData) => void;
    onError?: (error: string) => void;
    maxDurationSeconds?: number;
}

function resolvePreferredMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined') {
        return undefined;
    }

    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        return 'audio/webm;codecs=opus';
    }

    if (MediaRecorder.isTypeSupported('audio/webm')) {
        return 'audio/webm';
    }

    return undefined;
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            if (!result.includes(',')) {
                reject(new Error('Failed to convert audio to base64.'));
                return;
            }
            resolve(result.split(',')[1]);
        };
        reader.onerror = () => reject(new Error('FileReader failed while encoding audio.'));
        reader.readAsDataURL(blob);
    });
}

export const useMediaRecorder = ({
    onAudioCaptured,
    onError,
    maxDurationSeconds = 60,
}: UseMediaRecorderProps): UseMediaRecorderResult => {
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const silenceDetectorRef = useRef<SilenceDetectorHandle | null>(null);

    const cleanup = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        silenceDetectorRef.current?.dispose();
        silenceDetectorRef.current = null;

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);

    useEffect(() => cleanup, [cleanup]);

    const startRecording = useCallback(async () => {
        setError(null);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            silenceDetectorRef.current?.dispose();
            silenceDetectorRef.current = await createSilenceDetector(
                stream,
                DEFAULT_VOICE_CONFIG.silence,
            );

            const preferredMimeType = resolvePreferredMimeType();
            let mediaRecorder: MediaRecorder;
            try {
                mediaRecorder = preferredMimeType
                    ? new MediaRecorder(stream, { mimeType: preferredMimeType })
                    : new MediaRecorder(stream);
            } catch {
                mediaRecorder = new MediaRecorder(stream);
            }

            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                try {
                    if (chunksRef.current.length > 0) {
                        const mimeType = mediaRecorder.mimeType || preferredMimeType || 'audio/webm';
                        const blob = new Blob(chunksRef.current, { type: mimeType });
                        const base64 = await blobToBase64(blob);
                        onAudioCaptured({
                            blob,
                            base64,
                            mimeType,
                        });
                    }
                } catch (captureError) {
                    const message = captureError instanceof Error
                        ? captureError.message
                        : 'Failed to capture recorded audio.';
                    setError(message);
                    onError?.(message);
                } finally {
                    const summary = silenceDetectorRef.current?.getSummary();
                    if (summary && summary.totalFrames > 0) {
                        console.debug('[VoiceSilenceDetector] speechRatio', summary.speechRatio);
                    }
                    cleanup();
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
            setDuration(0);

            const startedAt = Date.now();
            timerRef.current = window.setInterval(() => {
                const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
                setDuration(elapsedSeconds);

                if (elapsedSeconds >= maxDurationSeconds && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                    setIsRecording(false);
                }
            }, 1000);
        } catch (startError) {
            const message = 'Could not access microphone. Please check permissions.';
            setError(message);
            onError?.(message);
            cleanup();
            console.error('Error accessing microphone:', startError);
        }
    }, [cleanup, maxDurationSeconds, onAudioCaptured, onError]);

    const stopRecording = useCallback(() => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
            return;
        }

        mediaRecorderRef.current.stop();
        setIsRecording(false);
    }, []);

    const cancelRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            chunksRef.current = [];
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }

        cleanup();
        setDuration(0);
    }, [cleanup]);

    return {
        isRecording,
        duration,
        error,
        startRecording,
        stopRecording,
        cancelRecording,
    };
};
