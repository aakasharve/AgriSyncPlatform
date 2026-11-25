using System.Diagnostics;
using System.Security.Cryptography;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.OwnerVoice;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// Who sends (until slice 15's creator site): ShramSafal staff holding the schedule-review seat (IEntitlementResolver.MayCheckSchedulesAsync), for a published (checked) reference schedule.
// No farm seat of any role sends. The recording is a REAL audio file the caller uploads; the server measures it, stores the bytes untouched under its own prefix through
// IAttachmentStorageService, and writes the clip metadata. There is NO text-to-speech path and no transcoding here. A message changes nothing by itself: this handler writes the
// clip(s), the message and one audit line, and nothing else (no own work, revision, plan or log).
//
// A change of plan points at a NEW version of the schedule that passed the check by someone other than its maker: a changed dose or product is a new checked version, never an
// edit of the one the farmers follow. Slice 15 will reuse this handler for creators.

/// <summary>One uploaded recording: the bytes, the file's name and the type the sender declared.</summary>
public sealed record OwnerClipUpload(byte[] Bytes, string? FileName, string? ContentType);

/// <summary>Send one message about one work of <see cref="ScheduleVersionId"/>.</summary>
public sealed record SendOwnerMessageCommand(
    Guid CallerUserId,
    Guid ScheduleVersionId,
    string Kind,
    string TaskKey,
    Guid? NewVersionId,
    string? AnswerFirst,
    string? AnswerSecond,
    OwnerClipUpload? Clip,
    OwnerClipUpload? FollowUpFirst,
    OwnerClipUpload? FollowUpSecond,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

/// <summary>A clip as the server keeps it (never the bytes).</summary>
public sealed record OwnerClipDto(Guid Id, Guid ChainId, Guid ScheduleVersionId, string MimeType, long SizeBytes, int DurationMs, string ContentHash, DateTime CreatedAtUtc);

/// <summary>A message as the server keeps it.</summary>
public sealed record OwnerMessageDto(
    Guid Id,
    Guid ChainId,
    Guid ScheduleVersionId,
    string TaskKey,
    string Kind,
    Guid ClipId,
    Guid? NewVersionId,
    string? AnswerFirst,
    string? AnswerSecond,
    Guid? FollowUpFirstClipId,
    Guid? FollowUpSecondClipId,
    DateTime SentAtUtc)
{
    public static OwnerMessageDto Of(ScheduleOwnerMessage m) => new(
        m.Id, m.ChainId, m.ScheduleVersionId, m.TaskKey, ScheduleOwnerMessageKindWire.ToWire(m.Kind), m.ClipId, m.NewVersionId, m.AnswerFirst, m.AnswerSecond,
        m.FollowUpFirstClipId, m.FollowUpSecondClipId, m.SentAtUtc);
}

public sealed record SendOwnerMessageResult(OwnerMessageDto Message, IReadOnlyList<OwnerClipDto> Clips);

public sealed class SendOwnerMessageHandler(
    IShramSafalRepository repository,
    IOwnerVoiceStore store,
    IAttachmentStorageService storage,
    IEntitlementResolver entitlements,
    IClock clock)
{
    public async Task<Result<SendOwnerMessageResult>> HandleAsync(SendOwnerMessageCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.CallerUserId == Guid.Empty || command.ScheduleVersionId == Guid.Empty)
        {
            return Result.Failure<SendOwnerMessageResult>(ShramSafalErrors.InvalidCommand);
        }

        var caller = new UserId(command.CallerUserId);

        // A PLATFORM act: a farm seat of any role is refused, whatever its authority.
        if (!await entitlements.MayCheckSchedulesAsync(caller, ct))
        {
            return Result.Failure<SendOwnerMessageResult>(ShramSafalErrors.Forbidden);
        }

        if (!ScheduleOwnerMessageKindWire.TryParse(command.Kind, out var kind))
        {
            return Refused("OwnerMessageKind", "A message is a tip, a change or a look, and nothing else.");
        }

        if (await repository.GetScheduleTemplateWithTasksByIdAsync(command.ScheduleVersionId, ct) is not { } version
            || version.TenantScope != TenantScope.Public || version.ChainId is not { } chainId || !version.IsInTaskFormat)
        {
            return Result.Failure<SendOwnerMessageResult>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        // The schedule farmers follow: published, so checked. A message on a schedule nobody may follow would be a voice nobody hears.
        if (await CheckProblemAsync(version, ct) is { } notChecked)
        {
            return Refused("OwnerMessageScheduleNotChecked", $"The schedule has not been checked ({notChecked}), so no message is sent about it.");
        }

        if (!version.Tasks.Any(t => string.Equals(t.TaskKey, command.TaskKey, StringComparison.Ordinal)))
        {
            return Refused("OwnerMessageTask", "The schedule has no work with this key.");
        }

        Guid? newVersionId = null;
        if (kind == ScheduleOwnerMessageKind.Change)
        {
            if (command.NewVersionId is not { } newId || newId == Guid.Empty)
            {
                return Refused("ChangeNeedsACheckedVersion", "A change of plan points at the new version of the schedule; none was named.");
            }

            var newer = await repository.GetScheduleTemplateWithTasksByIdAsync(newId, ct);
            if (newer is null || newer.TenantScope != TenantScope.Public || newer.ChainId != chainId || newer.Id == version.Id || newer.Version <= version.Version
                || !newer.Tasks.Any(t => string.Equals(t.TaskKey, command.TaskKey, StringComparison.Ordinal)))
            {
                return Refused("ChangeNeedsACheckedVersion", "A change points at a newer version of the same schedule that has this work.");
            }

            if (await CheckProblemAsync(newer, ct) is { } problem)
            {
                return Refused("ChangeNeedsACheckedVersion", $"A changed dose or product is a new version that was checked by someone other than its maker: {problem}.");
            }

            newVersionId = newId;
        }

        // The recordings: audio only, measured from the file, at most 5 MB and 90 seconds.
        var now = clock.UtcNow;
        var staged = new List<(Guid Id, OwnerClipUpload Upload, OwnerClipAudio Audio, string Hash)>();
        Guid? Take(OwnerClipUpload? upload, out Result<SendOwnerMessageResult>? failure)
        {
            failure = null;
            if (upload is null)
            {
                return null;
            }

            if (OwnerClipAudioProbe.Read(upload.Bytes, upload.ContentType, out var audio) is { } audioProblem)
            {
                failure = Refused(audioProblem.Code, audioProblem.Message);
                return null;
            }

            var id = Guid.NewGuid();
            staged.Add((id, upload, audio!, Convert.ToHexString(SHA256.HashData(upload.Bytes)).ToLowerInvariant()));
            return id;
        }

        var clipId = Take(command.Clip, out var failed);
        if (failed is not null)
        {
            return failed;
        }

        if (clipId is null)
        {
            return Refused("OwnerClipMissing", "A message needs its recording: a real audio file.");
        }

        Guid? followFirst = null;
        Guid? followSecond = null;
        if (kind == ScheduleOwnerMessageKind.Look)
        {
            followFirst = Take(command.FollowUpFirst, out failed);
            if (failed is not null)
            {
                return failed;
            }

            followSecond = Take(command.FollowUpSecond, out failed);
            if (failed is not null)
            {
                return failed;
            }
        }
        else if (command.FollowUpFirst is not null || command.FollowUpSecond is not null)
        {
            return Refused("OwnerMessageShape", "Only a look has follow-up clips.");
        }

        var messageId = Guid.NewGuid();
        var message = ScheduleOwnerMessage.Create(
            messageId, chainId, version.Id, command.TaskKey, kind, clipId.Value, newVersionId, command.AnswerFirst, command.AnswerSecond, followFirst, followSecond, caller, now, out var shape);
        if (message is null)
        {
            return Refused(shape!.Code, shape.Message);
        }

        var clips = new List<ScheduleOwnerClip>();
        foreach (var (id, upload, audio, hash) in staged)
        {
            var clip = ScheduleOwnerClip.Create(id, chainId, version.Id, caller, hash, audio.MimeType, upload.Bytes.LongLength, audio.DurationMs, now, out var clipProblem);
            if (clip is null)
            {
                return Refused(clipProblem!.Code, clipProblem.Message);
            }

            clips.Add(clip);
        }

        // The bytes first (a row without its file would be a voice that cannot play); a failed save removes what was written.
        var written = new List<string>();
        try
        {
            foreach (var (id, upload, audio, _) in staged)
            {
                await using var stream = new MemoryStream(upload.Bytes, writable: false);
                await storage.SaveAsync(ScheduleOwnerClip.StorageKeyFor(id), stream, audio.MimeType, ct);
                written.Add(ScheduleOwnerClip.StorageKeyFor(id));
            }

            foreach (var clip in clips)
            {
                store.Stage(clip);
            }

            store.Stage(message);
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "ScheduleOwnerMessage",
                    entityId: message.Id,
                    action: "schedule.owner_message.sent",
                    actorUserId: command.CallerUserId,
                    actorRole: "platform",
                    // No audio, no answers' words: the ids, the kind and the work.
                    payload: new { messageId = message.Id, kind = ScheduleOwnerMessageKindWire.ToWire(kind), scheduleVersionId = version.Id, taskKey = message.TaskKey, newVersionId, clips = clips.Count },
                    farmId: null,
                    clientCommandId: null,
                    appVersion: command.ClientAppVersion,
                    deviceId: command.AuditDeviceId,
                    ipHash: command.AuditIpHash,
                    sourceAiJobId: null),
                ct);
            await repository.SaveChangesAsync(ct);
        }
        catch
        {
            foreach (var key in written)
            {
                try
                {
                    await storage.DeleteAsync(key, CancellationToken.None);
                }
                catch (Exception ex)
                {
                    // best effort: an orphaned file holds no row and plays for nobody. The landing place is the trace: only the exception TYPE is recorded (a message can carry a path).
                    Activity.Current?.AddEvent(new ActivityEvent(
                        "owner_clip.orphan_file_not_removed",
                        tags: new ActivityTagsCollection { { "exception.type", ex.GetType().Name } }));
                }
            }

            throw;
        }

        return Result.Success(new SendOwnerMessageResult(OwnerMessageDto.Of(message), clips.Select(Dto).ToList()));
    }

    internal static OwnerClipDto Dto(ScheduleOwnerClip c) =>
        new(c.Id, c.ChainId, c.ScheduleVersionId, c.MimeType, c.SizeBytes, c.DurationMs, c.ContentHash, c.CreatedAtUtc);

    private static Result<SendOwnerMessageResult> Refused(string rule, string words) =>
        Result.Failure<SendOwnerMessageResult>(ShramSafalErrors.OwnScheduleInvalid(rule, words));

    /// <summary>Why this version may not be pointed at, or null when it was checked and the one who checked it is not its maker.</summary>
    private async Task<string?> CheckProblemAsync(ScheduleTemplate version, CancellationToken ct)
    {
        var checks = await repository.GetScheduleChecksAsync([version.Id], ct);
        var state = ScheduleCheck.StateOf(checks);
        if (state != ScheduleCheckState.Checked)
        {
            return $"its check is {state}";
        }

        var latest = ScheduleCheck.Latest(checks)!;
        return version.CreatedByUserId is { } maker && latest.CheckerUserId == maker ? "its maker checked it" : null;
    }
}

/// <summary>The staff list of the messages of a schedule's chain, with their clips' metadata (never bytes).</summary>
public sealed class ListOwnerMessagesHandler(
    IShramSafalRepository repository,
    IOwnerVoiceStore store,
    IEntitlementResolver entitlements)
{
    public async Task<Result<SendOwnerMessageListResult>> HandleAsync(Guid callerUserId, Guid scheduleVersionId, CancellationToken ct = default)
    {
        if (callerUserId == Guid.Empty || scheduleVersionId == Guid.Empty)
        {
            return Result.Failure<SendOwnerMessageListResult>(ShramSafalErrors.InvalidCommand);
        }

        if (!await entitlements.MayCheckSchedulesAsync(new UserId(callerUserId), ct))
        {
            return Result.Failure<SendOwnerMessageListResult>(ShramSafalErrors.Forbidden);
        }

        if (await repository.GetScheduleTemplateByIdAsync(scheduleVersionId, ct) is not { ChainId: { } chainId } template || template.TenantScope != TenantScope.Public)
        {
            return Result.Failure<SendOwnerMessageListResult>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var messages = await store.GetMessagesOfChainAsync(chainId, ct);
        var clips = await store.GetClipsAsync(messages.SelectMany(m => m.ClipIds()).Distinct().ToList(), ct);
        return Result.Success(new SendOwnerMessageListResult(messages.Select(OwnerMessageDto.Of).ToList(), clips.Select(SendOwnerMessageHandler.Dto).ToList()));
    }
}

public sealed record SendOwnerMessageListResult(IReadOnlyList<OwnerMessageDto> Messages, IReadOnlyList<OwnerClipDto> Clips);

/// <summary>A clip's bytes for a follower's phone (or the staff who sent it). Row security decides who sees the clip; the file is read only for a clip that is seen.</summary>
public sealed class GetOwnerClipHandler(IOwnerVoiceStore store, IAttachmentStorageService storage)
{
    public async Task<Result<OwnerClipFile>> HandleAsync(Guid clipId, CancellationToken ct = default)
    {
        if (clipId == Guid.Empty)
        {
            return Result.Failure<OwnerClipFile>(ShramSafalErrors.InvalidCommand);
        }

        // A clip of a schedule the caller's farm does not follow is not there for it at all (row security): the same answer as a clip that does not exist.
        if (await store.GetClipAsync(clipId, ct) is not { } clip)
        {
            return Result.Failure<OwnerClipFile>(Error.NotFound("ShramSafal.OwnerClipNotFound", "There is no such clip."));
        }

        var stream = await storage.OpenReadAsync(clip.StorageKey, ct);
        return stream is null
            ? Result.Failure<OwnerClipFile>(Error.NotFound("ShramSafal.OwnerClipNotFound", "There is no such clip."))
            : Result.Success(new OwnerClipFile(stream, clip.MimeType, clip.ContentHash, clip.DurationMs));
    }
}

public sealed record OwnerClipFile(Stream Content, string MimeType, string ContentHash, int DurationMs);
