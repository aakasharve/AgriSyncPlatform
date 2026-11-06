// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 2: N2)
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Consent;

namespace ShramSafal.Application.Privacy;

/// <summary>
/// The playback switch ("Allow playback of my original voice" / "मूळ आवाज ऐकू देणे"): is it ON for this speaker, under words that
/// count? Founder D-2: OFF stops replay and never deletes the clip. Founder D-50 choice 2: the switch is "who may listen" - him
/// and the people trusted to confirm. So while it is OFF NOBODY plays the recording, the speaker included, on any route.
/// The words that count are the current ones and the pre-rename ones (<see cref="CurrentConsentWording.VoiceKeepWordsAllowPlayback"/>:
/// the same listeners), so an ON given before the rename keeps working. An ON recorded with no words (before the reviewers were
/// disclosed) does not count.
/// </summary>
public static class OriginalVoiceSwitch
{
    /// <summary>For a REVIEWER (anyone but the speaker): ON, and under words that disclosed reviewers listening.</summary>
    public static async Task<bool> IsOnAsync(IShramSafalRepository repository, Guid speakerUserId, CancellationToken ct)
    {
        var consent = await repository.GetUserConsentStateAsync(speakerUserId, ct).ConfigureAwait(false);
        return consent is not null
            && consent.FullHistoryJournal
            && CurrentConsentWording.VoiceKeepWordsAllowPlayback(consent.FullHistoryJournalWordingVersion);
    }

    /// <summary>
    /// For the SPEAKER'S OWN Voice Diary: ON is enough, whatever words it was given under. The words matter because they disclosed
    /// REVIEWERS listening; a person listening to his own voice needs no such disclosure, and an ON given before those words existed
    /// must not silently stop his own playback.
    /// </summary>
    public static async Task<bool> IsOnForSpeakerAsync(IShramSafalRepository repository, Guid speakerUserId, CancellationToken ct)
    {
        var consent = await repository.GetUserConsentStateAsync(speakerUserId, ct).ConfigureAwait(false);
        return consent is not null && consent.FullHistoryJournal;
    }
}
