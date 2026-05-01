using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.CorrectCostEntry;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CorrectCostEntry): cost-entry existence +
/// owner-tier role authorization moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// The cost-entry must be loaded to know which farm to check, so the
/// authorizer takes <see cref="IShramSafalRepository"/> directly. No
/// <c>IAuthorizationEnforcer</c> method matches "load entry by id, then
/// check owner-tier role on the entry's farm" — adding one would
/// cascade to existing test stubs.
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.CostEntryNotFound"/> — cost-entry
/// id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> — actor's role on the
/// entry's farm is not PrimaryOwner or SecondaryOwner.</item>
/// </list>
/// </para>
/// </summary>
public sealed class CorrectCostEntryAuthorizer : IAuthorizationCheck<CorrectCostEntryCommand>
{
    private readonly IShramSafalRepository _repository;

    public CorrectCostEntryAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CorrectCostEntryCommand command, CancellationToken ct)
    {
        var entry = await _repository.GetCostEntryByIdAsync(command.CostEntryId, ct);
        if (entry is null)
        {
            return Result.Failure(ShramSafalErrors.CostEntryNotFound);
        }

        var role = await _repository.GetUserRoleForFarmAsync((Guid)entry.FarmId, command.CorrectedByUserId, ct);
        if (role is not AppRole.PrimaryOwner and not AppRole.SecondaryOwner)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
