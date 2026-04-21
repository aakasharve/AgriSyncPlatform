using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.RecordTestResult;

/// <summary>
/// Handler for <see cref="RecordTestResultCommand"/>. Gates role, delegates to
/// <see cref="TestInstance.RecordResult"/> (which enforces CEI-I5: >=1
/// attachment), runs the <see cref="TestRecommendationRuleBook"/>, persists
/// any raised recommendations, and emits an <see cref="AuditEvent"/> with
/// action <c>test.reported</c>.
///
/// TODO(CEI-phase3): full attachment-finalization check (the attachment must
/// be finalized and linked to this test instance). The domain guard only
/// enforces "non-empty". This requires Infrastructure access which breaks
/// Clean Architecture inside a handler.
///
/// TODO(CEI-phase3): replay-safe idempotency on <see cref="RecordTestResultCommand.ClientCommandId"/>.
/// The existing <c>ISyncMutationStore</c> is scoped to sync-push mutations;
/// this handler currently has no idempotency port — add one in Phase 3.
/// </summary>
public sealed class RecordTestResultHandler(
    ITestInstanceRepository testInstanceRepository,
    ITestRecommendationRepository testRecommendationRepository,
    IShramSafalRepository repository,
    IClock clock)
{
    private static readonly HashSet<AppRole> AllowedRoles =
    [
        AppRole.LabOperator
    ];

    public async Task<Result<RecordTestResultResponse>> HandleAsync(
        RecordTestResultCommand command,
        CancellationToken ct = default)
    {
        if (command is null ||
            command.TestInstanceId == Guid.Empty ||
            command.CallerUserId.IsEmpty ||
            command.Results is null || command.Results.Count == 0)
        {
            return Result.Failure<RecordTestResultResponse>(ShramSafalErrors.InvalidCommand);
        }

        if (!AllowedRoles.Contains(command.CallerRole))
        {
            return Result.Failure<RecordTestResultResponse>(ShramSafalErrors.TestRoleNotAllowed);
        }

        var instance = await testInstanceRepository.GetByIdAsync(command.TestInstanceId, ct);
        if (instance is null)
        {
            return Result.Failure<RecordTestResultResponse>(ShramSafalErrors.TestInstanceNotFound);
        }

        var now = clock.UtcNow;
        var attachmentIds = command.AttachmentIds ?? Array.Empty<Guid>();

        try
        {
            // Domain guards: CEI-I5 non-empty attachments, valid state,
            // caller role reassertion.
            instance.RecordResult(
                command.CallerUserId,
                command.CallerRole,
                command.Results,
                attachmentIds,
                now);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("CEI-I5"))
        {
            return Result.Failure<RecordTestResultResponse>(ShramSafalErrors.TestAttachmentInvalid);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<RecordTestResultResponse>(ShramSafalErrors.TestInvalidState);
        }
        catch (ArgumentException)
        {
            return Result.Failure<RecordTestResultResponse>(ShramSafalErrors.InvalidCommand);
        }

        // Evaluate rules — produces zero or more recommendations.
        var recommendations = TestRecommendationRuleBook.Evaluate(instance, now);
        if (recommendations.Count > 0)
        {
            await testRecommendationRepository.AddRangeAsync(recommendations, ct);
        }

        await testInstanceRepository.SaveChangesAsync(ct);

        var audit = AuditEvent.Create(
            farmId: instance.FarmId.Value,
            entityType: "TestInstance",
            entityId: instance.Id,
            action: "test.reported",
            actorUserId: command.CallerUserId.Value,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                testInstanceId = instance.Id,
                cropCycleId = instance.CropCycleId,
                plotId = instance.PlotId,
                resultCount = instance.Results.Count,
                attachmentCount = instance.AttachmentIds.Count,
                recommendationCount = recommendations.Count,
                reportedAtUtc = instance.ReportedAtUtc
            },
            clientCommandId: command.ClientCommandId,
            occurredAtUtc: now);

        await repository.AddAuditEventAsync(audit, ct);
        await repository.SaveChangesAsync(ct);

        var response = new RecordTestResultResponse(
            TestInstanceId: instance.Id,
            Status: instance.Status.ToString(),
            Recommendations: recommendations.Select(TestRecommendationDto.FromDomain).ToList());

        return Result.Success(response);
    }
}
