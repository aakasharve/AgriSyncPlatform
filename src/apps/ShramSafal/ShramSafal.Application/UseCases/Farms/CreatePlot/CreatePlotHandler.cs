using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.CreatePlot;

public sealed class CreatePlotHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
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

        return Result.Success(plot.ToDto());
    }
}
