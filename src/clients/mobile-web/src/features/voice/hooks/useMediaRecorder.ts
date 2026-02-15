import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioData } from '../../../types';

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

export const useMediaRecorder = ({
    onAudioCaptured,
    onError,
    maxDurationSeconds = 60
}: UseMediaRecorderProps): UseMediaRecorderResult => {

    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const cleanup = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);

    useEffect(() => {
        return cleanup;
    }, [cleanup]);

    const startRecording = useCallback(async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                // Only process if chunks exist (not cancelled)
                if (chunksRef.current.length > 0) {
                    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.readAsDataURL(blob);
                    reader.onloadend = () => {
                        const base64String = reader.result as string;
                        // Avoid errors if read failed
                        if (base64String) {
                            const base64 = base64String.split(',')[1];
                            onAudioCaptured({
                                blob,
                                base64,
                                mimeType: 'audio/webm'
                            });
                        }
                    };
                }
                cleanup();
            };

            mediaRecorder.start();
            setIsRecording(true);
            setDuration(0);

            // Timer
            const startTime = Date.now();
            timerRef.current = window.setInterval(() => {
                const currentDuration = Math.floor((Date.now() - startTime) / 1000);
                setDuration(currentDuration);

                if (currentDuration >= maxDurationSeconds) {
                    stopRecording();
                }
            }, 1000);

        } catch (err) {
            console.error("Error accessing microphone:", err);
            const msg = "Could not access microphone. Please check permissions.";
            setError(msg);
            if (onError) onError(msg);
        }
    }, [onAudioCaptured, onError, maxDurationSeconds, cleanup]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, []);

    const cancelRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            // Clear chunks to prevent processing
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
        cancelRecording
    };
};
