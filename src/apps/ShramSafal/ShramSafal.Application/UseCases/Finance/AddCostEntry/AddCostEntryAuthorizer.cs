using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.AddCostEntry;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): farm-existence + farm-
/// membership authorization moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Mirrors <c>CreateDailyLogAuthorizer</c> — takes
/// <see cref="IShramSafalRepository"/> directly because no
/// <c>IAuthorizationEnforcer</c> method matches "load farm by id, then
/// check membership" exactly. EF's first-level cache makes the body's
/// defense-in-depth re-lookup effectively free in the pipeline-consumer
/// path.
/// </para>
///
/// <para>
/// Error ordering preserved verbatim from the handler body:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.FarmNotFound"/> when the farm id
/// resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not a member of the target farm.</item>
/// </list>
/// Combined with the validator (which fires
/// <c>InvalidCommand</c> /
/// <c>UseSettleJobCardForLabourPayout</c> first), the full canonical
/// endpoint ordering is
/// <c>InvalidCommand → UseSettleJobCardForLabourPayout →
/// FarmNotFound → Forbidden → (entitlement) → PlotNotFound /
/// CropCycleNotFound → body</c>.
/// </para>
/// </summary>
public sealed class AddCostEntryAuthorizer : IAuthorizationCheck<AddCostEntryCommand>
{
    private readonly IShramSafalRepository _repository;

    public AddCostEntryAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(AddCostEntryCommand command, CancellationToken ct)
    {
        var farm = await _repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure(ShramSafalErrors.FarmNotFound);
        }

        var isMember = await _repository.IsUserMemberOfFarmAsync(command.FarmId, command.CreatedByUserId, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
