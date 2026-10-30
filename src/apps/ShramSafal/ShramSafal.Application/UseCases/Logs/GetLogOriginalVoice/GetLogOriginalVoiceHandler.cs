// spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — founder D-31.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Consent;

namespace ShramSafal.Application.UseCases.Logs.GetLogOriginalVoice;

public sealed record GetLogOriginalVoiceQuery(Guid DailyLogId, Guid CallerUserId);

/// <summary>
/// Why the original voice of a record cannot be played. The transcript stays visible in
/// every case (D-31: "keep the transcript available to permitted reviewers and show
/// 'Original recording unavailable.'").
/// </summary>
public static class OriginalVoiceUnavailableReason
{
    /// <summary>The record carries no link to a recording (typed, an older phone, an extra plot).</summary>
    public const string NoRecording = "no_recording";

    /// <summary>The speaker's "keep original voice" switch is not ON under the current words, or he
    /// has asked for his account to be erased.</summary>
    public const string NotKept = "not_kept";

    /// <summary>The linked recording is not on the server (not uploaded, or nothing to play).</summary>
    public const string NotOnServer = "not_on_server";
}

/// <summary>
/// The sealed recording, exactly as the archive holds it. The server never decrypts (Phase
/// 05.6): the listener's phone resolves the farm's key (it must be an active member of THAT
/// farm) and opens it bound to the clip id and the farm's owner account.
/// </summary>
public sealed record LogOriginalVoiceResult(
    bool Available,
    string? UnavailableReason,
    Guid? ClipId = null,
    DateTime? RecordedAtUtc = null,
    int? DurationSeconds = null,
    string? Language = null,
    string? DekId = null,
    string? IvBase64 = null,
    string? AuthTagBase64 = null,
    string? CipherBase64 = null)
{
    public static LogOriginalVoiceResult Unavailable(string reason) => new(false, reason);
}

/// <summary>
/// "मूळ आवाज ऐका" — the original voice behind ONE record, for a person allowed to review
/// THAT record. Founder D-31, three rules, each enforced here on the server:
/// <list type="number">
/// <item><b>Record access.</b> The listener is a member of the record's farm AND is either
/// the speaker himself, the primary owner, or a member holding the owner's grant
/// (<see cref="LabourManagementGate"/>). Approval authority does not unlock other records:
/// the recording reached is only the one THIS record links to. Anyone else is refused; a
/// person of another farm cannot even see the record (row-level security), so he gets
/// "not found".</item>
/// <item><b>Audio availability.</b> Playable only while the speaker's "मूळ आवाज जतन करा"
/// switch is ON under the CURRENT words (<see cref="CurrentConsentWording.VoiceKeepVersion"/>),
/// the words that disclose listening by reviewers. An ON chosen under older or unknown words
/// (every choice made before those words existed) is not re-confirmed, so it does not
/// count.</item>
/// <item><b>Privacy.</b> The recording must be the speaker's own clip; only the one clip the
/// record links to is ever returned.</item>
/// </list>
/// <item><b>Erasure.</b> Once the speaker has asked for his account to be erased, nobody hears
/// his voice any more — "unavailable", exactly as with the switch OFF — even before the erasure
/// run has removed the clip. The check is the SAME one <c>ImprovementPermissionGate</c> makes
/// (<see cref="IImprovementPermissionStore.IsAccountErasureRequestedAsync"/>, run in its own scope by
/// <see cref="IAccountErasureCheck"/>), never a second one.</item>
/// This changes nothing about what is stored (founder D-50 is open): it only decides who may
/// hear what is already kept.
/// </summary>
public sealed class GetLogOriginalVoiceHandler(
    IShramSafalRepository repository,
    IRetainedBlobStore retainedBlobStore,
    IAccountErasureCheck erasureRequests,
    IClock clock,
    ILogger<GetLogOriginalVoiceHandler> logger)
{
    public async Task<Result<LogOriginalVoiceResult>> HandleAsync(
        GetLogOriginalVoiceQuery query,
        CancellationToken ct = default)
    {
        if (query.DailyLogId == Guid.Empty || query.CallerUserId == Guid.Empty)
        {
            return Result.Failure<LogOriginalVoiceResult>(ShramSafalErrors.InvalidCommand);
        }

        var log = await repository.GetDailyLogByIdAsync(query.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<LogOriginalVoiceResult>(ShramSafalErrors.DailyLogNotFound);
        }

        var farmId = (Guid)log.FarmId;
        var role = await repository.GetUserRoleForFarmAsync(farmId, query.CallerUserId, ct);
        if (role is null)
        {
            return Result.Failure<LogOriginalVoiceResult>(ShramSafalErrors.ReadNotAllowed);
        }

        var speakerUserId = log.OperatorUserId.Value;
        // The ONE rule for who may hear a record's words (also the pull's content filter).
        var mayListen = await RecordWordsGate.MayHearAsync(
            query.CallerUserId,
            speakerUserId,
            role,
            () => LabourManagementGate.HasExplicitGrantAsync(
                repository, farmId, query.CallerUserId, clock.UtcNow, ct));
        if (!mayListen)
        {
            return Result.Failure<LogOriginalVoiceResult>(ShramSafalErrors.ReadNotAllowed);
        }

        if (log.VoiceClipId is not { } clipId)
        {
            return Result.Success(LogOriginalVoiceResult.Unavailable(OriginalVoiceUnavailableReason.NoRecording));
        }

        var consent = await repository.GetUserConsentStateAsync(speakerUserId, ct);
        var keptUnderCurrentWords = consent is not null
            && consent.FullHistoryJournal
            && string.Equals(
                consent.FullHistoryJournalWordingVersion,
                CurrentConsentWording.VoiceKeepVersion,
                StringComparison.Ordinal);
        if (!keptUnderCurrentWords)
        {
            return Result.Success(LogOriginalVoiceResult.Unavailable(OriginalVoiceUnavailableReason.NotKept));
        }

        // An account someone asked to erase licenses nothing (the improvement gate's rule, its
        // own check, run in its own scope so this request keeps its identity). Fail-closed: if it
        // cannot tell, the voice is not played. Asked BEFORE the clip is fetched (review S4), so
        // not a byte of an erased speaker's voice is even read from storage.
        bool erasureRequested;
        try
        {
            erasureRequested = await erasureRequests.IsErasureRequestedAsync(speakerUserId, ct);
        }
        catch (Exception ex)
        {
            // "We could not tell" and "he asked to be erased" get the same answer, on purpose.
            logger.LogWarning(ex,
                "Erasure state could not be read for a speaker; original voice not played (fail-closed).");
            return Result.Success(LogOriginalVoiceResult.Unavailable(OriginalVoiceUnavailableReason.NotKept));
        }

        if (erasureRequested)
        {
            return Result.Success(LogOriginalVoiceResult.Unavailable(OriginalVoiceUnavailableReason.NotKept));
        }

        // The SPEAKER's clip only: the archive is read with his id, so a link that names
        // someone else's recording finds nothing.
        var clip = await retainedBlobStore.GetByIdAsync(clipId, speakerUserId, ct);
        if (clip is null || clip.CipherBytes.Length == 0)
        {
            return Result.Success(LogOriginalVoiceResult.Unavailable(OriginalVoiceUnavailableReason.NotOnServer));
        }

        return Result.Success(new LogOriginalVoiceResult(
            Available: true,
            UnavailableReason: null,
            ClipId: clip.ClipId,
            RecordedAtUtc: clip.RecordedAtUtc,
            DurationSeconds: clip.DurationSeconds,
            Language: clip.Language,
            DekId: clip.DekId,
            IvBase64: clip.IvBase64,
            AuthTagBase64: clip.AuthTagBase64,
            CipherBase64: Convert.ToBase64String(clip.CipherBytes)));
    }
}
