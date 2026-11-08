/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2, founder TAP-1) - the plan form's mic: the log's OWN recorder
 * (`AudioRecorderStreaming`, or `AudioRecorder` where the streaming one is off - the same flag `core/navigation/logRecorder.tsx`
 * reads), not a copy. It only hands the finished sound to the form; it is given no typing sheet of its own (the form's work box is
 * always there, so voice is first and never the only way).
 */
import React from 'react';
import type { AudioData } from '../../../types';
import AudioRecorder from '../../voice/components/AudioRecorder';
import AudioRecorderStreaming from '../../voice/components/AudioRecorderStreaming';
import { DEFAULT_VOICE_CONFIG } from '../../../infrastructure/voice/types';

export const PlanMic: React.FC<{
    onAudio: (audio: AudioData) => void;
    onProcessingStart?: () => void;
    disabled?: boolean;
}> = ({ onAudio, onProcessingStart, disabled }) => (
    <div data-testid="plan-mic">
        {DEFAULT_VOICE_CONFIG.streamingPcm.enabled
            ? <AudioRecorderStreaming onAudioCaptured={onAudio} onProcessingStart={onProcessingStart} disabled={disabled} suggestInteraction />
            : <AudioRecorder onAudioCaptured={onAudio} disabled={disabled} suggestInteraction />}
    </div>
);

export default PlanMic;
