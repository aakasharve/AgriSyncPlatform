using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.CheckSchedule;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Creators;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Creators;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Creators: invite only ..., no self-approval"); build plan slice 15 (the creator door), server half.

public sealed record InvitedCreatorDto(Guid Id, string DisplayName, string? Phone, string Status, Guid InvitedByUserId, DateTime InvitedAtUtc, DateTime? FirstSignedInAtUtc);

public sealed record CreatorSubmissionForReviewDto(
    Guid Id, Guid WorkId, int Round, string Title, string State, Guid CreatorId, string? CreatorName, DateTime? SubmittedAtUtc, DateTime? DecidedAtUtc, Guid? LibraryScheduleId);

/// <summary>
/// One sent round as its staff checker sees it before deciding: built by the importer exactly as the library row WOULD be (no row exists yet), with the content hash his
/// ticks are recorded on, every stage, task and challenge in full, the clean files, and what was decided about the earlier rounds. <see cref="Problem"/> is set, and the hash
/// is null, when the importer no longer accepts the body: such a round can only be returned.
/// </summary>
public sealed record CreatorSubmissionCheckViewDto(
    CreatorSubmissionForReviewDto Submission,
    JsonElement Body,
    string? ContentHash,
    string? Problem,
    IReadOnlyList<CheckStageDto> Stages,
    IReadOnlyList<CheckTaskDto> Tasks,
    IReadOnlyList<CheckChallengeDto> Challenges,
    IReadOnlyList<CreatorFileDto> Files,
    IReadOnlyList<CreatorSubmissionDto> Rounds);

public sealed record CreatorApprovalDto(Guid SubmissionId, Guid LibraryScheduleId, int Version, string ContentHash, Guid CheckId, DateTime ApprovedAtUtc);

public sealed record CreatorReturnDto(Guid SubmissionId, Guid NewDraftId, int NewRound, DateTime ReturnedAtUtc);

/// <summary>Where a staff act came from, for its audit row.</summary>
public sealed record CreatorStaffAudit(string AppVersion = "unknown", string DeviceId = "unknown", string IpHash = "sha256:unknown");

/// <summary>
/// ShramSafal staff at the creator door: who is invited, and the check of what creators send. Every act is a PLATFORM act gated by the schedule-review seat
/// (<see cref="IEntitlementResolver.MayCheckSchedulesAsync"/> to write, <see cref="IEntitlementResolver.MayReadScheduleChecksAsync"/> to read): a farm seat of any role
/// holds nothing here, and a creator cannot reach these at all (his token is refused on every staff route).
///
/// <para><b>Approval is the only way a creator's work becomes a library row.</b> The server builds the row through the SAME importer the staff import uses, with the creator
/// as its maker, and records the check by the SAME rule as slice 7 (<see cref="ScheduleCheck.Approve(ScheduleTemplate, ScheduleCheckTicks, UserId, string, DateTime, out ScheduleCheckProblem?)"/>:
/// every task and challenge key ticked, on the content hash the checker saw, and never by the maker). The row and its approval are written together, so a creator's
/// schedule never exists in the library unchecked.</para>
/// </summary>
public sealed class CreatorReviewService(
    ICreatorDoorStore store,
    ICreatorDoorScope scope,
    IShramSafalRepository repository,
    IEntitlementResolver entitlements,
    IClock clock)
{
    /// <summary>May this person read what creators sent (the schedule-review seat, read)? Asked by the staff file route before a byte is opened.</summary>
    public Task<bool> MayReadAsync(Guid staffUserId, CancellationToken ct = default) => entitlements.MayReadScheduleChecksAsync(new UserId(staffUserId), ct);

    public async Task<Result<InvitedCreatorDto>> InviteAsync(Guid staffUserId, string? phone, string? displayName, CreatorStaffAudit audit, CancellationToken ct = default)
    {
        if (!await entitlements.MayCheckSchedulesAsync(new UserId(staffUserId), ct))
        {
            return Result.Failure<InvitedCreatorDto>(ShramSafalErrors.Forbidden);
        }

        var now = clock.UtcNow;
        var fresh = CreatorProfile.Invite(Guid.NewGuid(), phone, displayName, staffUserId, now, out var problem);
        if (fresh is null)
        {
            return Result.Failure<InvitedCreatorDto>(Error.Validation("Creator.Invite", $"{problem} Nobody was invited."));
        }

        var profile = await store.GetProfileByPhoneAsync(fresh.Phone!, ct);
        if (profile is null)
        {
            profile = fresh;
            store.Add(profile);
        }
        else
        {
            // Inviting an invited number again changes nothing; a revoked one may sign in again with the id and the work he had.
            profile.InviteAgain(staffUserId, now);
        }

        await repository.AddAuditEventAsync(Audit("CreatorProfile", profile.Id, "creator.invited", staffUserId, new { creatorId = profile.Id }, audit), ct);
        await store.SaveChangesAsync(ct);
        return Result.Success(ToDto(profile));
    }

    public async Task<Result<IReadOnlyList<InvitedCreatorDto>>> ListCreatorsAsync(Guid staffUserId, CancellationToken ct = default)
    {
        if (!await entitlements.MayReadScheduleChecksAsync(new UserId(staffUserId), ct))
        {
            return Result.Failure<IReadOnlyList<InvitedCreatorDto>>(ShramSafalErrors.Forbidden);
        }

        IReadOnlyList<InvitedCreatorDto> list = (await store.ListProfilesAsync(ct)).Select(ToDto).ToList();
        return Result.Success(list);
    }

    /// <summary>Ends a creator's access: his next request and his next refresh are refused. His work and its history stay.</summary>
    public async Task<Result<InvitedCreatorDto>> RevokeAsync(Guid staffUserId, Guid creatorId, CreatorStaffAudit audit, CancellationToken ct = default)
    {
        if (!await entitlements.MayCheckSchedulesAsync(new UserId(staffUserId), ct))
        {
            return Result.Failure<InvitedCreatorDto>(ShramSafalErrors.Forbidden);
        }

        var profile = await store.GetProfileAsync(creatorId, ct);
        if (profile is null)
        {
            return Result.Failure<InvitedCreatorDto>(CreatorDoorErrors.NotFound);
        }

        profile.Revoke(clock.UtcNow);
        await repository.AddAuditEventAsync(Audit("CreatorProfile", profile.Id, "creator.revoked", staffUserId, new { creatorId = profile.Id }, audit), ct);
        await store.SaveChangesAsync(ct);
        return Result.Success(ToDto(profile));
    }

    /// <summary>Every round a creator has SENT (waiting first), never a draft: row security does not show staff a draft at all.</summary>
    public async Task<Result<IReadOnlyList<CreatorSubmissionForReviewDto>>> ListSubmissionsAsync(Guid staffUserId, CancellationToken ct = default)
    {
        if (!await entitlements.MayReadScheduleChecksAsync(new UserId(staffUserId), ct))
        {
            return Result.Failure<IReadOnlyList<CreatorSubmissionForReviewDto>>(ShramSafalErrors.Forbidden);
        }

        var names = (await store.ListProfilesAsync(ct)).ToDictionary(p => p.Id, p => p.DisplayName);
        IReadOnlyList<CreatorSubmissionForReviewDto> list = (await store.ListSubmissionsAsync(ct))
            .Where(s => s.State != CreatorSubmissionState.Draft)
            .OrderBy(s => s.State == CreatorSubmissionState.Submitted ? 0 : 1).ThenBy(s => s.SubmittedAtUtc)
            .Select(s => ToReviewDto(s, names.GetValueOrDefault(s.CreatorId)))
            .ToList();
        return Result.Success(list);
    }

    public async Task<Result<CreatorSubmissionCheckViewDto>> ViewAsync(Guid staffUserId, Guid submissionId, CancellationToken ct = default)
    {
        if (!await entitlements.MayReadScheduleChecksAsync(new UserId(staffUserId), ct))
        {
            return Result.Failure<CreatorSubmissionCheckViewDto>(ShramSafalErrors.Forbidden);
        }

        var submission = await store.GetSubmissionAsync(submissionId, ct);
        if (submission is null || submission.State == CreatorSubmissionState.Draft)
        {
            return Result.Failure<CreatorSubmissionCheckViewDto>(CreatorDoorErrors.NotFound);
        }

        var profile = await store.GetProfileAsync(submission.CreatorId, ct);
        var rounds = (await store.ListRoundsOfWorkAsync(submission.WorkId, ct)).Where(r => r.State != CreatorSubmissionState.Draft).ToList();
        var decisions = await store.ListDecisionsAsync(rounds.Select(r => r.Id).ToList(), ct);
        var roundDtos = rounds.OrderBy(r => r.Round)
            .Select(r => CreatorWorkService.ToDto(r, decisions.Where(d => d.SubmissionId == r.Id).ToList()))
            .ToList();
        var files = (await store.ListFilesOfWorkAsync(submission.WorkId, ct))
            .Where(f => f.State == CreatorFileState.Clean)
            .Select(CreatorWorkService.ToDto)
            .ToList();

        var built = await CreatorBodies.BuildAsync(repository, submission.CreatorId, submission.BodyJson, clock.UtcNow, ct);
        var review = ToReviewDto(submission, profile?.DisplayName);
        var body = CreatorBodies.Element(submission.BodyJson);
        if (!built.IsSuccess)
        {
            return Result.Success(new CreatorSubmissionCheckViewDto(review, body, null, built.Error.Description, [], [], [], files, roundDtos));
        }

        var (stages, tasks, challenges) = GetScheduleCheckViewHandler.Describe(built.Value.Template);
        return Result.Success(new CreatorSubmissionCheckViewDto(
            review, body, built.Value.Template.TaskFormatHash(), null, stages, tasks, challenges, files, roundDtos));
    }

    /// <summary>
    /// Sends a round back with the checker's reasons. The round and the reasons are kept as they are; the creator gets the next round as a new draft holding the same body.
    /// </summary>
    public async Task<Result<CreatorReturnDto>> ReturnAsync(Guid staffUserId, Guid submissionId, string? reasons, CreatorStaffAudit audit, CancellationToken ct = default)
    {
        if (!await entitlements.MayCheckSchedulesAsync(new UserId(staffUserId), ct))
        {
            return Result.Failure<CreatorReturnDto>(ShramSafalErrors.Forbidden);
        }

        var words = reasons?.Trim();
        if (string.IsNullOrEmpty(words) || words.Length > CreatorSubmissionDecision.MaxReasonsLength)
        {
            return Result.Failure<CreatorReturnDto>(Error.Validation(
                "Creator.ReturnReasons", $"A return needs its reasons in words (at most {CreatorSubmissionDecision.MaxReasonsLength} characters). Nothing changed."));
        }

        var waiting = await WaitingAsync(submissionId, ct);
        if (!waiting.IsSuccess)
        {
            return Result.Failure<CreatorReturnDto>(waiting.Error);
        }

        var submission = waiting.Value;
        var now = clock.UtcNow;
        submission.Return(now);
        store.Add(new CreatorSubmissionDecision(Guid.NewGuid(), submission.Id, submission.CreatorId, CreatorDecisionKind.Returned, words, staffUserId, now, null, submission.ContentHash));
        var next = submission.NextRound(Guid.NewGuid(), now);
        store.Add(next);
        await repository.AddAuditEventAsync(
            Audit("CreatorSubmission", submission.Id, "creator.submission.returned", staffUserId, new { submissionId = submission.Id, round = submission.Round }, audit), ct);
        await store.SaveChangesAsync(ct);
        return Result.Success(new CreatorReturnDto(submission.Id, next.Id, next.Round, now));
    }

    public async Task<Result<CreatorApprovalDto>> ApproveAsync(
        Guid staffUserId,
        Guid submissionId,
        IReadOnlyList<string>? checkedTaskKeys,
        IReadOnlyList<string>? checkedChallengeKeys,
        string? contentHash,
        string? checkerDisplayName,
        CreatorStaffAudit audit,
        CancellationToken ct = default)
    {
        var checker = new UserId(staffUserId);
        if (!await entitlements.MayCheckSchedulesAsync(checker, ct))
        {
            return Result.Failure<CreatorApprovalDto>(ShramSafalErrors.Forbidden);
        }

        var waiting = await WaitingAsync(submissionId, ct);
        if (!waiting.IsSuccess)
        {
            return Result.Failure<CreatorApprovalDto>(waiting.Error);
        }

        var submission = waiting.Value;
        var now = clock.UtcNow;

        // The SAME importer, with the creator as the maker of the row.
        var built = await CreatorBodies.BuildAsync(repository, submission.CreatorId, submission.BodyJson, now, ct);
        if (!built.IsSuccess)
        {
            return Result.Failure<CreatorApprovalDto>(built.Error);
        }

        // The SAME check rule as slice 7: every key ticked, on the hash seen, never by the maker.
        var template = built.Value.Template;
        var check = ScheduleCheck.Approve(
            template, new ScheduleCheckTicks([], checkedTaskKeys, checkedChallengeKeys, contentHash), checker, checkerDisplayName ?? string.Empty, now, out var problem);
        if (check is null)
        {
            return Result.Failure<CreatorApprovalDto>(Error.Validation($"ShramSafal.{problem!.Code}", problem.Message));
        }

        // The library row is written as its maker (the row policy of its tasks asks for the maker's own identity); the staff scope is back when this returns.
        await scope.RunAsMakerOfLibraryRowAsync(submission.CreatorId, staffUserId, async token =>
        {
            await repository.AddScheduleTemplateAsync(template, token);
            await repository.SaveChangesAsync(token);
            return true;
        }, ct);

        await repository.AddScheduleCheckAsync(check, ct);
        submission.Approve(template.Id, now);
        store.Add(new CreatorSubmissionDecision(
            Guid.NewGuid(), submission.Id, submission.CreatorId, CreatorDecisionKind.Approved, null, staffUserId, now, template.Id, template.TaskFormatHash()));
        await repository.AddAuditEventAsync(Audit(
            "ScheduleTemplate", template.Id, "schedule.imported", staffUserId,
            new { templateId = template.Id, templateVersion = template.Version, format = ReferenceScheduleImporter.ReferenceFormat, creatorSubmissionId = submission.Id }, audit), ct);
        await repository.AddAuditEventAsync(Audit(
            "ScheduleTemplate", template.Id, "schedule.checked", staffUserId,
            new { templateId = template.Id, templateVersion = template.Version, decision = check.Decision.ToString() }, audit), ct);
        await store.SaveChangesAsync(ct);

        return Result.Success(new CreatorApprovalDto(submission.Id, template.Id, template.Version, template.TaskFormatHash()!, check.Id, now));
    }

    private async Task<Result<CreatorSubmission>> WaitingAsync(Guid submissionId, CancellationToken ct)
    {
        var submission = await store.GetSubmissionAsync(submissionId, ct);
        if (submission is null || submission.State == CreatorSubmissionState.Draft)
        {
            return Result.Failure<CreatorSubmission>(CreatorDoorErrors.NotFound);
        }

        return submission.State == CreatorSubmissionState.Submitted
            ? Result.Success(submission)
            : Result.Failure<CreatorSubmission>(Error.Conflict("Creator.AlreadyDecidedConflict", "This round was already decided. Nothing changed."));
    }

    private static AuditEvent Audit(string entityType, Guid entityId, string action, Guid staffUserId, object payload, CreatorStaffAudit audit) =>
        AuditEventFactory.Create(
            entityType: entityType,
            entityId: entityId,
            action: action,
            actorUserId: staffUserId,
            actorRole: "platform",
            payload: payload,
            farmId: null,
            clientCommandId: null,
            appVersion: audit.AppVersion,
            deviceId: audit.DeviceId,
            ipHash: audit.IpHash,
            sourceAiJobId: null);

    private static InvitedCreatorDto ToDto(CreatorProfile p) =>
        new(p.Id, p.DisplayName, p.Phone, p.Status.ToString(), p.InvitedByUserId, p.InvitedAtUtc, p.FirstSignedInAtUtc);

    private static CreatorSubmissionForReviewDto ToReviewDto(CreatorSubmission s, string? creatorName) =>
        new(s.Id, s.WorkId, s.Round, s.Title, s.State.ToString(), s.CreatorId, creatorName, s.SubmittedAtUtc, s.DecidedAtUtc, s.LibraryTemplateId);
}
