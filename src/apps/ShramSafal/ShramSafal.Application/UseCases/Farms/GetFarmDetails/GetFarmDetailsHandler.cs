using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.GetFarmDetails;

public sealed class GetFarmDetailsHandler(IShramSafalRepository repository)
{
    public async Task<Result<FarmDto>> HandleAsync(
        GetFarmDetailsCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty || command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.FarmNotFound);
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.CallerUserId, ct);
        if (!isMember)
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.FarmNotFound);
        }

        return Result.Success(farm.ToDto());
    }
}
