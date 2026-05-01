using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.CreatePlot;

/// <summary>
/// Creates a <see cref="Domain.Farms.Plot"/> on a given farm.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (CreatePlot): caller-shape validation lives
/// in <see cref="CreatePlotValidator"/>; farm-existence + owner-tier
/// authorization lives in <see cref="CreatePlotAuthorizer"/>. When this
/// handler is resolved via the pipeline, both run before the body. The
/// body retains its inline gates (farm lookup + role-tier check +
/// entitlement gate) as defense-in-depth — those checks remain the only
/// gate when callers bypass the pipeline (legacy unit tests, future
/// internal consumers). The endpoint path (POST /farms/{id}/plots) gets
/// the canonical <c>InvalidCommand → FarmNotFound → Forbidden</c>
/// ordering through the pipeline.
/// </para>
/// </summary>
public sealed class CreatePlotHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics)
    : IHandler<CreatePlotCommand, PlotDto>
{
    public async Task<Result<PlotDto>> HandleAsync(CreatePlotCommand command, CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty ||
            command.ActorUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.Name) ||
            command.AreaInAcres <= 0)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.PlotId.HasValue && command.PlotId.Value == Guid.Empty)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.FarmNotFound);
        }

        var actorRole = await repository.GetUserRoleForFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (actorRole is not AppRole.PrimaryOwner and not AppRole.SecondaryOwner)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.Forbidden);
        }
        var resolvedActorRole = actorRole.Value;

        // Phase 5 entitlement gate (PaidFeature.CreatePlot).
        var gate = await EntitlementGate.CheckAsync<PlotDto>(
            entitlementPolicy, new UserId(command.ActorUserId), new FarmId(command.FarmId),
            PaidFeature.CreatePlot, ct);
        if (gate is not null) return gate;

        var nowUtc = clock.UtcNow;
        var plot = Domain.Farms.Plot.Create(
            command.PlotId ?? idGenerator.New(),
            command.FarmId,
            command.Name,
            command.AreaInAcres,
            nowUtc);

        await repository.AddPlotAsync(plot, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                command.FarmId,
                "Plot",
                plot.Id,
                "Created",
                command.ActorUserId,
                resolvedActorRole.ToString(),
                new
                {
                    plot.Id,
                    command.FarmId,
                    plot.Name,
                    plot.AreaInAcres
                },
                command.ClientCommandId,
                nowUtc),
            ct);
        await repository.SaveChangesAsync(ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.PlotCreated,
            OccurredAtUtc: nowUtc,
            ActorUserId: new UserId(command.ActorUserId),
            FarmId: new FarmId(command.FarmId),
            OwnerAccountId: null,
            ActorRole: resolvedActorRole.ToString().ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                plotId = plot.Id,
                farmId = command.FarmId,
                plotName = plot.Name,
                areaInAcres = plot.AreaInAcres
            })
        ), ct);

        return Result.Success(plot.ToDto());
    }
}
