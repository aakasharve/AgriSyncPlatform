/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourMic — a DOORWAY to the canonical log-page mic, not a recorder.
 *
 * The app takes voice input in exactly ONE place: the log page
 * (`mainView.tsx`, route `'main'`, `features/voice/AudioRecorder`). Labour
 * voice data already reaches this feature the proper way — log page →
 * server parse → the `shift`/`task`/`worker_names_json` columns on
 * `labour_assignments` → this feature's read-model — so a second, parallel
 * recording surface here was never needed beyond an early UAT stand-in.
 *
 * This component keeps the log screen's mic ORB *visual* (the same big
 * centred emerald gradient orb, top gloss, inner-shadow depth) purely as an
 * invitation to go log by voice. Tapping it does not record anything —
 * it calls `onGoToLog`, which the caller wires to navigation onto the log
 * page.
 */
import React from 'react';
import { Mic } from 'lucide-react';

interface Props {
    onGoToLog: () => void;
}

const LabourMic: React.FC<Props> = ({ onGoToLog }) => (
    <div className="flex flex-col items-center rounded-[28px] border border-white/60 bg-white/80 px-5 py-6 shadow-2xl shadow-emerald-100/60 backdrop-blur-xl">
        {/* MIC ORB — identical visual to the log screen's idle mic. */}
        <div className="relative mb-5">
            <button
                type="button"
                onClick={onGoToLog}
                aria-label="लॉग स्क्रीनवर बोला"
                className="group relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-xl shadow-emerald-500/30 outline-none ring-4 ring-transparent transition-all duration-500 hover:scale-105 hover:ring-emerald-200 active:scale-95"
            >
                {/* top gloss shine */}
                <div className="pointer-events-none absolute inset-x-4 top-2 h-1/2 rounded-full bg-gradient-to-b from-white/40 to-transparent opacity-80" />
                {/* inner depth */}
                <div className="pointer-events-none absolute inset-0 rounded-full opacity-30 shadow-inner mix-blend-multiply" />
                <Mic size={48} className="text-white drop-shadow-md transition-transform group-hover:scale-110" />
            </button>
        </div>

        <div className="w-full text-center">
            <h3 className="text-2xl font-bold text-stone-800">बोलून नोंद करा</h3>
            <p className="mt-1 text-[15px] text-stone-400">लॉग स्क्रीनवर बोला — हजेरी आपोआप भरेल</p>
        </div>
    </div>
);

export default LabourMic;
