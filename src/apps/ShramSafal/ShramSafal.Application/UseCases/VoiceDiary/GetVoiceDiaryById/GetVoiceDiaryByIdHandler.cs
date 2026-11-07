// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 2: N2)
//
// One kept recording, with its bytes, for the person who made it. Founder D-2: while the playback switch is OFF nothing is played, the
// speaker included; nothing is deleted, and turning the switch ON again makes the kept clip playable again. The switch is asked BEFORE the
// clip is read from storage.

using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy;
using ShramSafal.Application.Privacy.Ports;

namespace ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryById;

public enum VoiceDiaryByIdOutcome
{
    Found,
    NotFound,

    /// <summary>The playback switch is OFF: the clip is kept, but not played.</summary>
    SwitchOff,
}

public sealed record VoiceDiaryByIdResult(VoiceDiaryByIdOutcome Outcome, RetainedClipResult? Clip);

public sealed class GetVoiceDiaryByIdHandler(IRetainedBlobStore retainedBlobStore, IShramSafalRepository repository)
{
    public async Task<VoiceDiaryByIdResult> HandleAsync(Guid clipId, Guid callerUserId, CancellationToken ct = default)
    {
        if (!await OriginalVoiceSwitch.IsOnForSpeakerAsync(repository, callerUserId, ct).ConfigureAwait(false))
        {
            return new VoiceDiaryByIdResult(VoiceDiaryByIdOutcome.SwitchOff, null);
        }

        var clip = await retainedBlobStore.GetByIdAsync(clipId, callerUserId, ct).ConfigureAwait(false);
        return clip is null
            ? new VoiceDiaryByIdResult(VoiceDiaryByIdOutcome.NotFound, null)
            : new VoiceDiaryByIdResult(VoiceDiaryByIdOutcome.Found, clip);
    }
}
