
import React, { useEffect, useState, useRef } from 'react';

interface SplashScreenProps {
    onComplete: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    const [isVisible, setIsVisible] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const videoElement = videoRef.current;

        // Fallback: If video doesn't end or fails to start within 5 seconds, force complete
        // This protects against broken video files or autoplay blocking
        const safetyTimer = setTimeout(() => {
            handleComplete();
        }, 8000);

        if (videoElement) {
            // Ensure strictly muted for autoplay policies
            videoElement.muted = true;

            videoElement.play().catch(error => {
                console.warn("Splash video autoplay failed:", error);
                // If autoplay fails, we might want to just show the logo fallback or skip
                // For now, let the safety timer handle the transition if it doesn't play
            });
        }

        return () => {
            clearTimeout(safetyTimer);
        };
    }, []);

    const handleComplete = () => {
        setIsVisible(false);
        // Wait for fade out transition
        setTimeout(onComplete, 500);
    };

    return (
        <div
            className={`fixed inset-0 z-[100] flex items-center justify-center bg-black transition-opacity duration-500 ease-out overflow-hidden ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
        >
            <style>
                {`
                    /* Hide default video controls */
                    video::-webkit-media-controls {
                        display: none !important;
                    }
                    video::-webkit-media-controls-enclosure {
                        display: none !important;
                    }
                `}
            </style>
            <video
                ref={videoRef}
                src="/splash.mp4"
                className="w-[100dvw] h-[100dvh] object-cover pointer-events-none select-none"
                playsInline
                muted
                autoPlay
                onEnded={handleComplete}
                onError={(e) => {
                    console.error("Video load error", e);
                    handleComplete(); // Skip if error
                }}
            />
        </div>
    );
};

export default SplashScreen;
