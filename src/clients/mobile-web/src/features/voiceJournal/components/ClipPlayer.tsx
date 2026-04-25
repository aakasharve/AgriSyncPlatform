import React, { useEffect, useState } from 'react';
import type { VoiceClipCacheRecord } from '../../../infrastructure/storage/DexieDatabase';

interface ClipPlayerProps {
    clip: VoiceClipCacheRecord;
}

const ClipPlayer: React.FC<ClipPlayerProps> = ({ clip }) => {
    const [audioUrl, setAudioUrl] = useState<string>('');

    useEffect(() => {
        const url = URL.createObjectURL(clip.localBlob);
        setAudioUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [clip.localBlob]);

    return (
        <audio
            controls
            preload="metadata"
            src={audioUrl}
            className="h-10 w-full"
        />
    );
};

export default ClipPlayer;
