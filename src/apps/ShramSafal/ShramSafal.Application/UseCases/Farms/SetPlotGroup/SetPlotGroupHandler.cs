using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Farms.SetPlotGroup;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane GRP-1a. Names (or clears) the owner's group label on one plot and
/// answers the updated <see cref="PlotDto"/>. Same shape as <see cref="CreatePlot.CreatePlotHandler"/>: caller-shape validation
/// in <see cref="SetPlotGroupValidator"/> and farm-existence + edit-farm-setup in <see cref="SetPlotGroupAuthorizer"/> run first
/// when the handler is resolved through the pipeline; the body keeps the same gates for callers that bypass it.
///
/// <para>
/// A change bumps the plot's <c>ModifiedAtUtc</c> (the existing pull carries it to every phone) and writes ONE audit row
/// (P3 of the doctrine: a correction is never silent) - who, which plot, the old name, the new name. The same name again is a
/// success that changes and records nothing. Last write wins; the next pull makes every phone agree.
/// </para>
///
/// <para>
/// Order of refusals: <see cref="ShramSafalErrors.InvalidCommand"/>, <see cref="ShramSafalErrors.FarmNotFound"/>,
/// <see cref="ShramSafalErrors.Forbidden"/> (no edit-farm-setup authority on THIS farm),
/// <see cref="ShramSafalErrors.PlotNotFound"/> (no such plot, or it is on another farm - the two answer alike).
/// </para>
/// </summary>
public sealed class SetPlotGroupHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<SetPlotGroupCommand, PlotDto>
{
    public async Task<Result<PlotDto>> HandleAsync(SetPlotGroupCommand command, CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty
            || command.PlotId == Guid.Empty
            || command.ActorUserId == Guid.Empty)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.InvalidCommand);
        }

        string? groupName;
        try
        {
            groupName = Plot.NormalizeGroupName(command.GroupName);
        }
        catch (ArgumentException)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.FarmNotFound);
        }

        // The same gate add-plot uses (edit farm setup, from THIS farm's seat; a label grants nothing). The role is read for
        // the audit row only.
        var actorRole = await repository.GetUserRoleForFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (actorRole is null
            || !await FarmAuthorityGate.HoldsAsync(
                repository, command.FarmId, command.ActorUserId, FarmAuthority.EditFarmSetup, clock.UtcNow, ct))
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.Forbidden);
        }

        var plot = await repository.GetPlotByIdAsync(command.PlotId, ct);
        if (plot is null || (Guid)plot.FarmId != command.FarmId)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.PlotNotFound);
        }

        var previousGroupName = plot.GroupName;
        if (!plot.SetGroup(groupName, clock.UtcNow))
        {
            // Already exactly this name (or already none): a success that changes and records nothing.
            return Result.Success(plot.ToDto());
        }

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "Plot",
                entityId: plot.Id,
                action: "GroupChanged",
                actorUserId: command.ActorUserId,
                actorRole: actorRole.Value.ToString(),
                payload: new
                {
                    plotId = plot.Id,
                    farmId = command.FarmId,
                    plotName = plot.Name,
                    oldGroupName = previousGroupName,
                    newGroupName = plot.GroupName
                },
                farmId: command.FarmId,
                clientCommandId: command.ClientCommandId,
                appVersion: command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(plot.ToDto());
    }
}
