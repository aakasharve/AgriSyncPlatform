using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Planning.CheckSchedule;
using ShramSafal.Application.UseCases.Schedules.GetScheduleTotals;
using ShramSafal.Domain.Creators;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Creators;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Making a schedule"); build plan slice 15 (the creator door), server half.

public sealed record CreatorProfileDto(Guid Id, string DisplayName, string? PhoneEnding, string Status, string? TermsVersion, bool TermsAccepted);

public sealed record CreatorDecisionDto(string Decision, string? Reasons, DateTime DecidedAtUtc, Guid? LibraryScheduleId);

public sealed record CreatorFileDto(Guid Id, Guid SubmissionId, string FileName, string MimeType, long SizeBytes, string State, string? Words, DateTime CreatedAtUtc);

public sealed record CreatorSubmissionDto(
    Guid Id,
    Guid WorkId,
    int Round,
    string Title,
    string State,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    DateTime? SubmittedAtUtc,
    DateTime? ExpiresAtUtc,
    Guid? LibraryScheduleId,
    IReadOnlyList<CreatorDecisionDto> Decisions);

public sealed record CreatorSubmissionDetailDto(CreatorSubmissionDto Submission, JsonElement Body, IReadOnlyList<CreatorSubmissionDto> Rounds, IReadOnlyList<CreatorFileDto> Files);

public sealed record CreatorErasureDto(Guid RequestId, string Status, DateTime RequestedAtUtc);

/// <summary>A creator's draft body read and built by the ONE importer: the body as sent, and the library row it WOULD make (in memory only).</summary>
public sealed record CreatorBuiltBody(ReferenceScheduleBody Body, ScheduleTemplate Template);

public static class CreatorBodies
{
    /// <summary>Strict: a key the format does not have is a refusal, never something silently dropped.</summary>
    private static readonly JsonSerializerOptions Strict = new(JsonSerializerDefaults.Web) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };

    private static readonly ScheduleOwnerType[] CreatorOwnerTypes = [ScheduleOwnerType.Expert, ScheduleOwnerType.Institution];

    /// <summary>
    /// Reads a creator's body and builds it with <see cref="ReferenceScheduleImporter"/> under the creator as maker. Refused with words when: it is too big, it is not the
    /// format-2 shape, it claims to be ShramSafal's own or a farmer's, it names an earlier version, or any importer rule refuses it.
    /// </summary>
    public static async Task<Result<CreatorBuiltBody>> BuildAsync(IShramSafalRepository repository, Guid creatorId, string? bodyJson, DateTime nowUtc, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(bodyJson))
        {
            return Fail("Creator.BodyMissing", "Send the schedule (format 2) as the body. Nothing was saved.");
        }

        if (Encoding.UTF8.GetByteCount(bodyJson) > CreatorSubmission.MaxBodyBytes)
        {
            return Fail("Creator.BodyTooLarge", $"The schedule is larger than {CreatorSubmission.MaxBodyBytes / 1024} KB. Nothing was saved.");
        }

        ReferenceScheduleBody? body;
        try
        {
            body = JsonSerializer.Deserialize<ReferenceScheduleBody>(bodyJson, Strict);
        }
        catch (JsonException ex)
        {
            // Not swallowed: the refusal carries the reader's own words back to the creator.
            return Result.Failure<CreatorBuiltBody>(Error.Validation(
                "Creator.BodyShape", $"The schedule is not in the format-2 shape ({Short(ex.Message)}). Nothing was saved."));
        }

        if (body is null)
        {
            return Fail("Creator.BodyMissing", "Send the schedule (format 2) as the body. Nothing was saved.");
        }

        if (ScheduleOwnerTypeWire.TryParse(body.OwnerType, out var ownerType) && !CreatorOwnerTypes.Contains(ownerType))
        {
            return Fail("Creator.OwnerType", "A creator sends work as EXPERT or INSTITUTION. Nothing was saved.");
        }

        if (body.PreviousVersionId is not null)
        {
            return Fail("Creator.PreviousVersion", "A new version of an existing schedule cannot be sent from here yet; send it as new work. Nothing was saved.");
        }

        var built = await ReferenceScheduleImporter.BuildAsync(repository, body, new UserId(creatorId), Guid.NewGuid(), nowUtc, ct);
        return built.IsSuccess
            ? Result.Success(new CreatorBuiltBody(body, built.Value))
            : Result.Failure<CreatorBuiltBody>(built.Error);
    }

    public static JsonElement Element(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static string Short(string text) => text.Length > 160 ? text[..160] : text;

    private static Result<CreatorBuiltBody> Fail(string code, string words) => Result.Failure<CreatorBuiltBody>(Error.Validation(code, words));
}

/// <summary>
/// What a signed-in creator may do with his OWN work: his profile, the terms, his drafts, sending a draft, his rounds with their return reasons, and the totals of his own
/// approved schedules. Every call runs under the creator's scope (the endpoint opens it), so the database shows him his own rows only; this class adds the rules. It holds no
/// way to approve, publish, read a farm, or see another creator's work.
/// </summary>
public sealed class CreatorWorkService(
    ICreatorDoorStore store,
    IShramSafalRepository repository,
    IAttachmentStorageService storage,
    GetScheduleTotalsHandler totals,
    CreatorDoorOptions options,
    IClock clock)
{
    /// <summary>The caller's profile when he may still use the door (invited staff did not revoke him, he was not erased); else null and every route answers 401.</summary>
    public async Task<CreatorProfile?> ActiveProfileAsync(Guid creatorId, CancellationToken ct = default)
    {
        var profile = await store.GetProfileAsync(creatorId, ct);
        return profile is { Status: CreatorStatus.Active } ? profile : null;
    }

    public async Task<CreatorProfileDto> ProfileAsync(CreatorProfile profile, CancellationToken ct = default)
    {
        var required = RequiredTerms;
        var accepted = required is not null && (await store.ListTermsAsync(profile.Id, ct)).Any(t => t.TermsVersion == required);
        return new CreatorProfileDto(
            profile.Id, profile.DisplayName, profile.Phone is { Length: >= 4 } phone ? phone[^4..] : null, profile.Status.ToString(), required, accepted);
    }

    public async Task<Result<CreatorProfileDto>> RenameAsync(CreatorProfile profile, string? displayName, CancellationToken ct = default)
    {
        if (!profile.Rename(displayName, clock.UtcNow))
        {
            return Result.Failure<CreatorProfileDto>(Error.Validation("Creator.Name", $"The name must be 1 to {CreatorProfile.MaxNameLength} characters. Nothing was saved."));
        }

        await store.SaveChangesAsync(ct);
        return Result.Success(await ProfileAsync(profile, ct));
    }

    public async Task<Result<CreatorProfileDto>> AcceptTermsAsync(CreatorProfile profile, string? version, CancellationToken ct = default)
    {
        var required = RequiredTerms;
        if (required is null)
        {
            return Result.Failure<CreatorProfileDto>(Error.Validation("Creator.TermsNotSet", "The creator terms are not published yet. Nothing was saved."));
        }

        if (!string.Equals(version?.Trim(), required, StringComparison.Ordinal))
        {
            return Result.Failure<CreatorProfileDto>(Error.Validation("Creator.TermsVersion", $"The terms in force are version {required}. Read them and agree to that version."));
        }

        if ((await store.ListTermsAsync(profile.Id, ct)).All(t => t.TermsVersion != required))
        {
            store.Add(new CreatorTermsAcceptance(Guid.NewGuid(), profile.Id, required, clock.UtcNow));
            await store.SaveChangesAsync(ct);
        }

        return Result.Success(await ProfileAsync(profile, ct));
    }

    /// <summary>
    /// The creator asks for his data to be erased (the same request ledger and waiting period as every person's). The erasure anonymises him and deletes his files and
    /// unsent drafts; a schedule already approved into the library keeps its content with its maker anonymised (doctrine P6).
    /// </summary>
    public async Task<CreatorErasureDto> RequestErasureAsync(CreatorProfile profile, CancellationToken ct = default)
    {
        var waiting = await repository.GetWaitingErasureRequestForAsync(profile.Id, ct);
        if (waiting is null)
        {
            waiting = ErasureRequest.Submit(profile.Id, null, clock.UtcNow);
            await repository.AddErasureRequestAsync(waiting, ct);
            await repository.SaveChangesAsync(ct);
        }

        return new CreatorErasureDto(waiting.Id, waiting.Status.ToString(), waiting.RequestedAtUtc);
    }

    public async Task<IReadOnlyList<CreatorSubmissionDto>> ListAsync(CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var rounds = (await store.ListSubmissionsAsync(ct)).Where(s => !s.IsExpired(now)).ToList();
        return await ToDtosAsync(rounds, ct);
    }

    public async Task<Result<CreatorSubmissionDto>> CreateDraftAsync(Guid creatorId, string? bodyJson, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var built = await CreatorBodies.BuildAsync(repository, creatorId, bodyJson, now, ct);
        if (!built.IsSuccess)
        {
            return Result.Failure<CreatorSubmissionDto>(built.Error);
        }

        var draft = CreatorSubmission.NewDraft(Guid.NewGuid(), creatorId, built.Value.Template.Name, bodyJson!, now);
        store.Add(draft);
        await store.SaveChangesAsync(ct);
        return Result.Success(ToDto(draft, []));
    }

    public async Task<Result<CreatorSubmissionDto>> ReplaceDraftAsync(Guid creatorId, Guid submissionId, string? bodyJson, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var draft = await OwnDraftAsync(submissionId, now, ct);
        if (!draft.IsSuccess)
        {
            return Result.Failure<CreatorSubmissionDto>(draft.Error);
        }

        var built = await CreatorBodies.BuildAsync(repository, creatorId, bodyJson, now, ct);
        if (!built.IsSuccess)
        {
            return Result.Failure<CreatorSubmissionDto>(built.Error);
        }

        draft.Value.ReplaceBody(built.Value.Template.Name, bodyJson!, now);
        await store.SaveChangesAsync(ct);
        return Result.Success(ToDto(draft.Value, []));
    }

    /// <summary>Removes a draft that was never sent, with the files attached to that round. A round that was sent is history and stays.</summary>
    public async Task<Result> DeleteDraftAsync(Guid submissionId, CancellationToken ct = default)
    {
        var draft = await OwnDraftAsync(submissionId, clock.UtcNow, ct);
        if (!draft.IsSuccess)
        {
            return Result.Failure(draft.Error);
        }

        foreach (var file in (await store.ListFilesOfWorkAsync(draft.Value.WorkId, ct)).Where(f => f.SubmissionId == draft.Value.Id))
        {
            if (file.State != CreatorFileState.Blocked)
            {
                await storage.DeleteAsync(file.StorageKey, ct);
            }

            store.Remove(file);
        }

        store.Remove(draft.Value);
        await store.SaveChangesAsync(ct);
        return Result.Success();
    }

    /// <summary>
    /// Sends a draft for ShramSafal's check. From here the round is frozen: the creator cannot change it, and only a staff checker moves it on. It is NOT a library row and
    /// no farmer can see it.
    /// </summary>
    public async Task<Result<CreatorSubmissionDto>> SubmitAsync(Guid creatorId, Guid submissionId, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var draft = await OwnDraftAsync(submissionId, now, ct);
        if (!draft.IsSuccess)
        {
            return Result.Failure<CreatorSubmissionDto>(draft.Error);
        }

        if (RequiredTerms is { } required && (await store.ListTermsAsync(creatorId, ct)).All(t => t.TermsVersion != required))
        {
            return Result.Failure<CreatorSubmissionDto>(Error.Validation(
                "Creator.TermsNotAccepted", $"Agree to the creator terms (version {required}) before sending. Nothing was sent."));
        }

        if ((await store.ListFilesOfWorkAsync(draft.Value.WorkId, ct)).Any(f => f.State == CreatorFileState.Quarantined))
        {
            return Result.Failure<CreatorSubmissionDto>(Error.Validation(
                "Creator.FileNotChecked", "A file of this work is still being checked. Send again when every file is checked. Nothing was sent."));
        }

        var built = await CreatorBodies.BuildAsync(repository, creatorId, draft.Value.BodyJson, now, ct);
        if (!built.IsSuccess)
        {
            return Result.Failure<CreatorSubmissionDto>(built.Error);
        }

        draft.Value.Submit(built.Value.Template.TaskFormatHash()!, now);
        await store.SaveChangesAsync(ct);
        return Result.Success(ToDto(draft.Value, []));
    }

    public async Task<Result<CreatorSubmissionDetailDto>> GetAsync(Guid submissionId, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var submission = await store.GetSubmissionAsync(submissionId, ct);
        if (submission is null || submission.IsExpired(now))
        {
            return Result.Failure<CreatorSubmissionDetailDto>(CreatorDoorErrors.NotFound);
        }

        var rounds = (await store.ListRoundsOfWorkAsync(submission.WorkId, ct)).Where(r => !r.IsExpired(now)).ToList();
        var dtos = await ToDtosAsync(rounds, ct);
        var files = (await store.ListFilesOfWorkAsync(submission.WorkId, ct)).Select(ToDto).ToList();
        return Result.Success(new CreatorSubmissionDetailDto(dtos.Single(d => d.Id == submission.Id), CreatorBodies.Element(submission.BodyJson), dtos, files));
    }

    /// <summary>The totals of one of his OWN approved schedules (slice 13's counts: nothing identifying, nothing under five farmers). Any other round has none.</summary>
    public async Task<Result<ScheduleTotalsDto>> TotalsAsync(Guid creatorId, Guid submissionId, CancellationToken ct = default)
    {
        var submission = await store.GetSubmissionAsync(submissionId, ct);
        if (submission is null)
        {
            return Result.Failure<ScheduleTotalsDto>(CreatorDoorErrors.NotFound);
        }

        if (submission is not { State: CreatorSubmissionState.Approved, LibraryTemplateId: { } templateId })
        {
            return Result.Failure<ScheduleTotalsDto>(Error.Validation("Creator.NotApproved", "Totals exist only for a schedule ShramSafal has approved."));
        }

        return await totals.HandleAsync(creatorId, templateId, ct);
    }

    private string? RequiredTerms => string.IsNullOrWhiteSpace(options.TermsVersion) ? null : options.TermsVersion.Trim();

    private async Task<Result<CreatorSubmission>> OwnDraftAsync(Guid submissionId, DateTime now, CancellationToken ct)
    {
        var submission = await store.GetSubmissionAsync(submissionId, ct);
        if (submission is null || submission.IsExpired(now))
        {
            return Result.Failure<CreatorSubmission>(CreatorDoorErrors.NotFound);
        }

        return submission.State == CreatorSubmissionState.Draft
            ? Result.Success(submission)
            : Result.Failure<CreatorSubmission>(Error.Conflict(
                "Creator.NotADraftConflict", "This round was already sent and cannot be changed. If it was returned, change the new draft it opened."));
    }

    private async Task<IReadOnlyList<CreatorSubmissionDto>> ToDtosAsync(IReadOnlyList<CreatorSubmission> rounds, CancellationToken ct)
    {
        var decisions = await store.ListDecisionsAsync(rounds.Select(r => r.Id).ToList(), ct);
        return rounds
            .OrderByDescending(r => r.ModifiedAtUtc).ThenByDescending(r => r.Round)
            .Select(r => ToDto(r, decisions.Where(d => d.SubmissionId == r.Id).ToList()))
            .ToList();
    }

    internal static CreatorSubmissionDto ToDto(CreatorSubmission s, IReadOnlyList<CreatorSubmissionDecision> decisions) => new(
        s.Id, s.WorkId, s.Round, s.Title, s.State.ToString(), s.CreatedAtUtc, s.ModifiedAtUtc, s.SubmittedAtUtc, s.ExpiresAtUtc, s.LibraryTemplateId,
        decisions.OrderBy(d => d.DecidedAtUtc).Select(d => new CreatorDecisionDto(d.Decision.ToString(), d.Reasons, d.DecidedAtUtc, d.LibraryTemplateId)).ToList());

    internal static CreatorFileDto ToDto(CreatorFile f) =>
        new(f.Id, f.SubmissionId, f.FileName, f.MimeType, f.SizeBytes, f.State.ToString(), f.ScanWords, f.CreatedAtUtc);
}

/// <summary>The bytes of one clean file, for its creator or a staff checker.</summary>
public sealed record CreatorFileContent(Stream Content, string MimeType, string FileName, string ContentHash);

/// <summary>
/// A creator's files. Read from the bytes, never the name: PDF, JPEG or PNG only, ten megabytes a file, ten files and fifty megabytes a piece of work. The scanner decides
/// BEFORE any byte is kept; a refused file leaves a row saying what was refused and why, and no bytes. Everything in a picture that can say where it was taken is removed
/// before it is kept. No file is ever read for its meaning.
/// </summary>
public sealed class CreatorFileService(
    ICreatorDoorStore store,
    IAttachmentStorageService storage,
    ICreatorFileScanner scanner,
    IClock clock)
{
    public async Task<Result<CreatorFileDto>> UploadAsync(Guid creatorId, Guid submissionId, byte[] bytes, string? fileName, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var submission = await store.GetSubmissionAsync(submissionId, ct);
        if (submission is null || submission.IsExpired(now))
        {
            return Result.Failure<CreatorFileDto>(CreatorDoorErrors.NotFound);
        }

        if (submission.State != CreatorSubmissionState.Draft)
        {
            return Fail("Creator.NotADraftConflict", "A file can be added only to a draft. Nothing was saved.", conflict: true);
        }

        if (bytes.Length == 0)
        {
            return Fail("Creator.FileEmpty", "The file is empty. Nothing was saved.");
        }

        if (bytes.LongLength > CreatorFile.MaxBytes)
        {
            return Fail("Creator.FileTooLarge", $"A file may be at most {CreatorFile.MaxBytes / (1024 * 1024)} MB. Nothing was saved.");
        }

        var name = CreatorFile.CleanName(fileName);
        var kind = CreatorFileBytes.Sniff(bytes);
        var verdict = await scanner.ScanAsync(bytes, name, ct);
        if (verdict.Verdict == CreatorScanVerdict.Blocked)
        {
            // What was refused and why is kept (its hash and size, no bytes).
            var refused = new CreatorFile(
                Guid.NewGuid(), creatorId, submission.WorkId, submission.Id, name, CreatorFileBytes.MimeOf(kind), bytes.LongLength, HashOf(bytes), now);
            refused.MarkBlocked(verdict.ScannerName, verdict.Words ?? "The file was refused.", now);
            store.Add(refused);
            await store.SaveChangesAsync(ct);
            return Fail("Creator.FileBlocked", $"{refused.ScanWords} The file was not kept.");
        }

        // The door's own rule, whichever scanner is plugged in.
        if (kind == CreatorFileKind.Unknown)
        {
            return Fail("Creator.FileType", "Only PDF, JPEG and PNG files are taken (read from the file itself, not its name). Nothing was saved.");
        }

        var kept = (await store.ListFilesOfWorkAsync(submission.WorkId, ct)).Where(f => f.State != CreatorFileState.Blocked).ToList();
        if (kept.Count >= CreatorFile.MaxFilesPerWork)
        {
            return Fail("Creator.FileCount", $"A piece of work may hold at most {CreatorFile.MaxFilesPerWork} files. Nothing was saved.");
        }

        var cleaned = CreatorFileBytes.StripLocation(bytes, kind);
        if (cleaned is null)
        {
            return Fail("Creator.FileBroken", "The picture could not be read to remove where it was taken, so it was not kept. Save it again as a JPEG or PNG and send it once more.");
        }

        if (kept.Sum(f => f.SizeBytes) + cleaned.LongLength > CreatorFile.MaxBytesPerWork)
        {
            return Fail("Creator.FileTotal", $"The files of a piece of work may total at most {CreatorFile.MaxBytesPerWork / (1024 * 1024)} MB. Nothing was saved.");
        }

        var file = new CreatorFile(
            Guid.NewGuid(), creatorId, submission.WorkId, submission.Id, name, CreatorFileBytes.MimeOf(kind), cleaned.LongLength, HashOf(cleaned), now);
        using (var content = new MemoryStream(cleaned, writable: false))
        {
            await storage.SaveAsync(file.StorageKey, content, file.MimeType, ct);
        }

        if (verdict.Verdict == CreatorScanVerdict.Clean)
        {
            file.MarkClean(verdict.ScannerName, now);
        }

        store.Add(file);
        await store.SaveChangesAsync(ct);
        return Result.Success(CreatorWorkService.ToDto(file));
    }

    /// <summary>The bytes of a file the caller's scope may see, and only once the scanner has passed it.</summary>
    public async Task<Result<CreatorFileContent>> OpenAsync(Guid fileId, CancellationToken ct = default)
    {
        var file = await store.GetFileAsync(fileId, ct);
        if (file is not { State: CreatorFileState.Clean })
        {
            return Result.Failure<CreatorFileContent>(CreatorDoorErrors.NotFound);
        }

        var content = await storage.OpenReadAsync(file.StorageKey, ct);
        return content is null
            ? Result.Failure<CreatorFileContent>(CreatorDoorErrors.NotFound)
            : Result.Success(new CreatorFileContent(content, file.MimeType, file.FileName, file.ContentHash));
    }

    public async Task<Result> DeleteAsync(Guid fileId, CancellationToken ct = default)
    {
        var file = await store.GetFileAsync(fileId, ct);
        if (file is null)
        {
            return Result.Failure(CreatorDoorErrors.NotFound);
        }

        var round = await store.GetSubmissionAsync(file.SubmissionId, ct);
        if (round is not { State: CreatorSubmissionState.Draft })
        {
            return Result.Failure(Error.Conflict("Creator.FileSentConflict", "This file was sent with a round and stays with it."));
        }

        if (file.State != CreatorFileState.Blocked)
        {
            await storage.DeleteAsync(file.StorageKey, ct);
        }

        store.Remove(file);
        await store.SaveChangesAsync(ct);
        return Result.Success();
    }

    private static string HashOf(byte[] bytes) => Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(bytes));

    private static Result<CreatorFileDto> Fail(string code, string words, bool conflict = false) =>
        Result.Failure<CreatorFileDto>(conflict ? Error.Conflict(code, words) : Error.Validation(code, words));
}
