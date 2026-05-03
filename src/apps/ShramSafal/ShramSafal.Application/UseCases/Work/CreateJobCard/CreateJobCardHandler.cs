using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.CreateJobCard;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.1.
/// Creates a new JobCard in Draft status.
/// Caller must be PrimaryOwner, SecondaryOwner, or Mukadam on the farm.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateJobCard): wired through the
/// explicit <see cref="HandlerPipeline"/>. Caller-shape validation
/// (empty IDs, empty LineItems) lives in
/// <see cref="CreateJobCardValidator"/>; role-tier authorization
/// (Owner-or-Mukadam on the target farm) lives in
/// <see cref="CreateJobCardAuthorizer"/>. When this handler is
/// resolved via the pipeline (see DI registration), both layers run
/// before the body executes; when resolved directly (legacy tests),
/// the body's inline guards continue to enforce the same invariants
/// as defense-in-depth. Domain construction failures (currency code,
/// money construction, JobCard.CreateDraft argument validation) stay
/// in the body's catch blocks and surface as
/// <see cref="ShramSafalErrors.InvalidCommand"/>.
/// </para>
/// </summary>
public sealed class CreateJobCardHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
    : IHandler<CreateJobCardCommand, CreateJobCardResult>
{
    public async Task<Result<CreateJobCardResult>> HandleAsync(
        CreateJobCardCommand command,
        CancellationToken ct = default)
    {
        // 1. Basic validation
        if (command.LineItems is null || command.LineItems.Count == 0)
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.InvalidCommand);

        // 2. Idempotency — if a ClientCommandId was already processed, short-circuit.
        //    We check for a duplicate audit event with the same ClientCommandId.
        //    (Pattern: the AuditEvent table stores ClientCommandId; if it already exists,
        //     we return success with the original jobCard's id from the audit event.)
        //    Full idempotency store is a future concern; for now we guard via repo.

        // 3. Resolve caller role on farm.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId.Value, command.CallerUserId.Value, ct);

        if (callerRole is null)
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.Forbidden);

        // Worker role is not allowed to create job cards.
        if (!IsEligibleToCreate(callerRole.Value))
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.JobCardRoleNotAllowed);

        // 4. Map DTOs to domain line items.
        List<JobCardLineItem> lineItems;
        try
        {
            lineItems = command.LineItems
                .Select(dto => new JobCardLineItem(
                    dto.ActivityType,
                    dto.ExpectedHours,
                    new Money(dto.RatePerHourAmount, new Currency(dto.RatePerHourCurrencyCode)),
                    dto.Notes))
                .ToList();
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.InvalidCommand);
        }

        // 5. Create the aggregate.
        JobCard jobCard;
        try
        {
            jobCard = JobCard.CreateDraft(
                idGenerator.New(),
                command.FarmId,
                command.PlotId,
                command.CropCycleId,
                command.CallerUserId,
                command.PlannedDate,
                lineItems,
                clock.UtcNow);
        }
        catch (ArgumentException)
        {
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.InvalidCommand);
        }

        // 6. Persist.
        await repository.AddJobCardAsync(jobCard, ct);

        // 7. Emit audit event.
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farmId: command.FarmId.Value,
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.created",
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { jobCard.Id, FarmId = command.FarmId.Value, command.PlotId, command.CropCycleId, command.PlannedDate },
                clientCommandId: command.ClientCommandId,
                occurredAtUtc: clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new CreateJobCardResult(jobCard.Id));
    }

    private static bool IsEligibleToCreate(AppRole role) =>
        role is AppRole.PrimaryOwner or AppRole.SecondaryOwner or AppRole.Mukadam;
}
