// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b) - on the job card (the owner's and the mukadam's): the play button for the clip of the message whose STANDING
// decision is "accepted" and names this job (the accepted row carries `jobId`). Once the decision is taken back (or changed) the standing row is no longer "accepted" and the
// button is gone. Any Active seat may play (a mukadam on his job card); the first full play queues "heard" for the plot the state names. Draws nothing for any other job.
import React from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { OwnerClipPlay } from './OwnerClipPlay';
import { OwnerVoiceCommands } from './ownerVoiceCommands';
import { acceptedMessageForJob, isHeard } from './ownerVoiceModel';
import { useOwnerClipPrefetch, useOwnerVoiceView } from './useOwnerVoice';
import { ownerVoiceWords } from './ownerVoiceWords';
import type { OwnerMessage, OwnerMessageState, OwnerVoiceView } from './ownerVoiceTypes';

const Body: React.FC<{ message: OwnerMessage; state: OwnerMessageState; view: OwnerVoiceView }> = ({ message, state, view }) => {
    const words = ownerVoiceWords(useOptionalLanguage()?.language === 'en' ? 'en' : 'mr');
    useOwnerClipPrefetch(state.farmId, [message]);
    return (
        <div className="mt-1.5 space-y-1 rounded-xl bg-orange-50 px-2.5 py-2" data-testid="job-clip">
            <p className="m-0 text-[13px] font-extrabold text-orange-900">{words.jobClip}</p>
            <OwnerClipPlay clipId={message.clipId} kept={view.keptClips.has(message.clipId)} words={words} testId="job-clip-play" notFetchedTestId="job-clip-not-fetched"
                onFullPlay={() => {
                    if (isHeard(view, state.plotId, message.id)) return;
                    void OwnerVoiceCommands.heard({ farmId: state.farmId, plotId: state.plotId }, message.id).then(() => { backgroundSyncWorker.triggerNow().catch(() => undefined); }, () => undefined);
                }} />
        </div>
    );
};

export const JobCardClip: React.FC<{ jobId: string }> = ({ jobId }) => {
    const view = useOwnerVoiceView();
    const found = acceptedMessageForJob(view, jobId);
    if (!found) return null;
    return <Body message={found.message} state={found.state} view={view} />;
};
