import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { PROCESSING_VOICE_CLIP_RETENTION_DAYS } from '../../../infrastructure/voice/VoiceClipRetention';

const RetentionBanner: React.FC = () => (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-900">
        <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-white p-2 text-emerald-700 shadow-sm">
                <ShieldCheck size={18} strokeWidth={2.4} />
            </div>
            <div>
                <h3 className="text-sm font-black">Processing journal</h3>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-emerald-800">
                    Voice recordings stay on this device for {PROCESSING_VOICE_CLIP_RETENTION_DAYS} days and auto-delete after that.
                </p>
            </div>
        </div>
    </div>
);

export default RetentionBanner;
