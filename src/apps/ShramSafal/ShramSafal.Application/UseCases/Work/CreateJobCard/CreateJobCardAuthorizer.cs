using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.CreateJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateJobCard): authorization moves OUT
/// of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
/// Mirrors <c>SettleJobCardPayoutAuthorizer</c>'s role-tier shape:
/// resolves the caller's role on the target farm and enforces the
/// "Owner or Mukadam" tier rule that <c>CreateJobCardHandler</c>
/// previously executed inline.
///
/// <para>
/// Like <c>AddLogTaskAuthorizer</c> / <c>CompleteJobCardAuthorizer</c>,
/// this authorizer takes <see cref="IShramSafalRepository"/> directly
/// rather than delegating to
/// <see cref="AgriSync.BuildingBlocks.Auth.IAuthorizationEnforcer"/>.
/// No enforcer method matches "resolve role on farm and gate by Owner-
/// tier-or-Mukadam"; adding one would cascade across multiple test
/// stubs. The repo lookup pre-fetches the role for the body via EF's
/// first-level cache when both layers run inside the same scope.
/// </para>
///
/// <para>
/// Error contract preserves the body's ordering exactly:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.Forbidden"/> when role resolution
/// returns <c>null</c> (no membership on farm).</item>
/// <item><see cref="ShramSafalErrors.JobCardRoleNotAllowed"/> when the
/// caller is a member but the role is not PrimaryOwner / SecondaryOwner
/// / Mukadam.</item>
/// </list>
/// Combined with <see cref="CreateJobCardValidator"/> the canonical
/// pipeline ordering on the endpoint and sync paths is
/// <c>InvalidCommand → Forbidden → JobCardRoleNotAllowed → (body checks)</c>.
/// Note: there's no farm-existence gate in the original body or here —
/// the role lookup returning null absorbs that case under
/// <see cref="ShramSafalErrors.Forbidden"/>.
/// </para>
/// </summary>
public sealed class CreateJobCardAuthorizer : IAuthorizationCheck<CreateJobCardCommand>
{
    private readonly IShramSafalRepository _repository;

    public CreateJobCardAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CreateJobCardCommand command, CancellationToken ct)
    {
        var role = await _repository.GetUserRoleForFarmAsync(
            command.FarmId.Value, command.CallerUserId.Value, ct);

        if (role is null)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        if (!IsEligibleToCreate(role.Value))
        {
            return Result.Failure(ShramSafalErrors.JobCardRoleNotAllowed);
        }

        return Result.Success();
    }

    private static bool IsEligibleToCreate(AppRole role) =>
        role is AppRole.PrimaryOwner or AppRole.SecondaryOwner or AppRole.Mukadam;
}
