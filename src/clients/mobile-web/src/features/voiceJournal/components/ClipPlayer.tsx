import React, { useEffect, useState } from 'react';
import type { VoiceClipCacheRecord } from '../../../infrastructure/storage/DexieDatabase';

interface ClipPlayerProps {
    clip: VoiceClipCacheRecord;
}

const ClipPlayer: React.FC<ClipPlayerProps> = ({ clip }) => {
    const [audioUrl, setAudioUrl] = useState<string>('');

    useEffect(() => {
        // spec: data-principle-spine-2026-05-05/05.3
        // Post-v18 voice clips no longer carry plaintext `localBlob`; their
        // bytes live in the sealed triple (ciphertext+iv+wrappedDekId)
        // and require a DEK round-trip to play. Until the journal UI is
        // upgraded to call `readVoiceClipPlaintext` (follow-up phase),
        // sealed clips render with an empty audio src — the controls
        // still mount so the layout doesn't jump. Legacy plaintext rows
        // (pre-v18, flagged `needsResealOnNextAccess`) still play here
        // as before.
        if (!clip.localBlob) {
            setAudioUrl('');
            return;
        }
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
